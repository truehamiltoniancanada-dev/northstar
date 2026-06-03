import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { StatusBar } from 'expo-status-bar'
import * as SecureStore from 'expo-secure-store'
import * as Speech from 'expo-speech'
import * as WebBrowser from 'expo-web-browser'
import { ExpoSpeechRecognitionModule, ExpoWebSpeechRecognition } from 'expo-speech-recognition'

const API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL || 'https://api.sentryharbor.com/api'
const TOKEN_KEY = 'sentryharbor.mobile.token'
const COACH_KEY = 'sentryharbor.mobile.coach'

const coaches = [
  {
    id: 'coach-w',
    name: 'Coach W',
    tone: 'Grounded, strategic, quietly protective',
    bestFor: 'Overwhelm, anxiety, and nights when you need to stabilize first.',
  },
  {
    id: 'coach-h',
    name: 'Coach H',
    tone: 'Warm, honest, accountability-first',
    bestFor: 'Shame, avoidance, and telling the truth without beating yourself up.',
  },
  {
    id: 'coach-o',
    name: 'Coach O',
    tone: 'Sharp, clear, dignity-first',
    bestFor: 'Catastrophizing, distorted stories, weak boundaries, and decisive action.',
  },
]

const quickPrompts = [
  'Help me calm down',
  'Reality-test this',
  'Help me not make this worse',
  'Tell me the honest truth',
]

async function saveToken(token) {
  if (token) {
    await SecureStore.setItemAsync(TOKEN_KEY, token)
  } else {
    await SecureStore.deleteItemAsync(TOKEN_KEY)
  }
}

async function saveCoach(coachId) {
  await SecureStore.setItemAsync(COACH_KEY, coachId)
}

export default function App() {
  const [screen, setScreen] = useState('welcome')
  const [token, setToken] = useState('')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [devCode, setDevCode] = useState('')
  const [authStep, setAuthStep] = useState('request')
  const [membershipActive, setMembershipActive] = useState(false)
  const [subscriptionStatus, setSubscriptionStatus] = useState('inactive')
  const [selectedCoachId, setSelectedCoachId] = useState(coaches[0].id)
  const [messages, setMessages] = useState([])
  const [draft, setDraft] = useState('')
  const [status, setStatus] = useState('')
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [listening, setListening] = useState(false)
  const recognitionRef = useRef(null)

  const selectedCoach = useMemo(
    () => coaches.find((coach) => coach.id === selectedCoachId) || coaches[0],
    [selectedCoachId]
  )

  useEffect(() => {
    async function boot() {
      try {
        const [storedToken, storedCoach] = await Promise.all([
          SecureStore.getItemAsync(TOKEN_KEY),
          SecureStore.getItemAsync(COACH_KEY),
        ])
        if (storedCoach && coaches.some((coach) => coach.id === storedCoach)) {
          setSelectedCoachId(storedCoach)
        }
        if (storedToken) {
          setToken(storedToken)
          await refreshStatus(storedToken, storedCoach || selectedCoachId)
        } else {
          setScreen('welcome')
        }
      } catch (error) {
        setStatus(error.message)
      } finally {
        setLoading(false)
      }
    }
    boot()
  }, [])

  async function request(path, options = {}) {
    const headers = {
      'Content-Type': 'application/json',
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
    }
    const response = await fetch(`${API_BASE_URL}${path}`, {
      method: options.method || 'GET',
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
    })
    const data = await response.json().catch(() => ({}))
    if (response.status === 401) {
      await signOut()
      throw new Error('Your session expired. Please sign in again.')
    }
    if (response.status === 403) {
      setMembershipActive(false)
      setScreen('membership')
      throw new Error(data.error || 'Active membership required')
    }
    if (!response.ok) {
      throw new Error(data.error || 'Request failed')
    }
    return data
  }

  async function refreshStatus(nextToken = token, coachId = selectedCoachId) {
    const data = await request('/auth/status', { token: nextToken })
    setEmail(data.user?.email || '')
    setMembershipActive(Boolean(data.user?.membershipActive))
    setSubscriptionStatus(data.user?.subscriptionStatus || 'inactive')
    if (data.user?.membershipActive) {
      setScreen('chat')
      await loadHistory(nextToken, coachId)
    } else {
      setScreen('membership')
    }
  }

  async function requestCode() {
    if (!email.trim()) return
    setStatus('Sending verification code...')
    try {
      const data = await request('/auth/request-code', {
        method: 'POST',
        body: { email },
      })
      setDevCode(data.devCode || '')
      setAuthStep('verify')
      setStatus('Code sent. Check your email.')
    } catch (error) {
      setStatus(error.message)
    }
  }

  async function verifyCode() {
    if (!email.trim() || !code.trim()) return
    setStatus('Verifying...')
    try {
      const data = await request('/auth/verify-code', {
        method: 'POST',
        body: { email, code },
      })
      await saveToken(data.token)
      setToken(data.token)
      setCode('')
      setDevCode('')
      setMembershipActive(Boolean(data.user?.membershipActive))
      setSubscriptionStatus(data.user?.subscriptionStatus || 'inactive')
      setScreen(data.user?.membershipActive ? 'coach' : 'membership')
      setStatus('')
    } catch (error) {
      setStatus(error.message)
    }
  }

  async function beginCheckout() {
    setStatus('Opening checkout...')
    try {
      const data = await request('/billing/checkout-session', {
        method: 'POST',
        body: {},
        token,
      })
      await WebBrowser.openBrowserAsync(data.url)
      setStatus('Return here after checkout, then tap Refresh membership.')
    } catch (error) {
      setStatus(error.message)
    }
  }

  async function openBillingPortal() {
    try {
      const data = await request('/billing/portal-session', {
        method: 'POST',
        body: {},
        token,
      })
      await WebBrowser.openBrowserAsync(data.url)
    } catch (error) {
      setStatus(error.message)
    }
  }

  async function chooseCoach(coachId) {
    setSelectedCoachId(coachId)
    await saveCoach(coachId)
    if (membershipActive) {
      await loadHistory(token, coachId)
      setScreen('chat')
    }
  }

  async function loadHistory(nextToken = token, coachId = selectedCoachId) {
    try {
      const data = await request(`/chat/history?listenerId=${encodeURIComponent(coachId)}`, { token: nextToken })
      setMessages(Array.isArray(data.messages) ? data.messages : [])
    } catch (error) {
      setStatus(error.message)
    }
  }

  async function sendMessage(text = draft) {
    const message = text.trim()
    if (!message || sending) return
    setSending(true)
    setDraft('')
    setMessages((current) => [...current, { role: 'user', label: 'You', text: message }])
    try {
      const data = await request('/chat', {
        method: 'POST',
        body: { listenerId: selectedCoach.id, message },
        token,
      })
      setMessages((current) => [
        ...current,
        {
          role: 'assistant',
          label: selectedCoach.name,
          text: data.reply,
          escalated: Boolean(data.escalated),
        },
      ])
      if (data.escalated) {
        Alert.alert(
          'Urgent human help',
          'If you may hurt yourself or someone else, call local emergency services now. In the US and Canada, call or text 988.'
        )
      }
    } catch (error) {
      setStatus(error.message)
    } finally {
      setSending(false)
    }
  }

  async function startListening() {
    try {
      if (!ExpoSpeechRecognitionModule.isRecognitionAvailable()) {
        setStatus('Voice input is not available on this device. Text still works.')
        return
      }
      const permissions = await ExpoSpeechRecognitionModule.requestPermissionsAsync()
      if (!permissions.granted) {
        setStatus('Microphone and speech recognition permission are required for voice input.')
        return
      }
      const recognition = new ExpoWebSpeechRecognition()
      recognition.continuous = false
      recognition.interimResults = true
      recognition.lang = 'en-US'
      recognition.onresult = (event) => {
        const transcript = Array.from(event.results)
          .map((result) => result[0]?.transcript || '')
          .join(' ')
          .trim()
        if (transcript) setDraft(transcript)
      }
      recognition.onerror = (event) => {
        setStatus(event?.message || 'Voice input stopped. You can keep typing.')
        setListening(false)
      }
      recognition.onend = () => setListening(false)
      recognitionRef.current = recognition
      setListening(true)
      recognition.start()
    } catch (error) {
      setListening(false)
      setStatus(error.message || 'Voice input is unavailable. Text still works.')
    }
  }

  function stopListening() {
    recognitionRef.current?.stop?.()
    setListening(false)
  }

  function speakLastReply() {
    const lastReply = [...messages].reverse().find((message) => message.role === 'assistant')
    if (!lastReply) {
      setStatus('No coach reply to play yet.')
      return
    }
    Speech.stop()
    Speech.speak(lastReply.text, { rate: 0.96, pitch: 1 })
  }

  async function signOut() {
    await saveToken('')
    setToken('')
    setMembershipActive(false)
    setMessages([])
    setScreen('welcome')
    setAuthStep('request')
    setStatus('')
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.center}>
          <ActivityIndicator color="#9b315f" />
          <Text style={styles.muted}>Loading Sentryharbor...</Text>
        </View>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar style="dark" />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.header}>
          <View style={styles.logo}>
            <Text style={styles.logoText}>S</Text>
          </View>
          <View style={styles.flex}>
            <Text style={styles.brand}>Sentryharbor</Text>
            <Text style={styles.tagline}>a steady guide for difficult nights</Text>
          </View>
          {token ? (
            <Pressable style={styles.smallButton} onPress={() => setScreen('settings')}>
              <Text style={styles.smallButtonText}>Settings</Text>
            </Pressable>
          ) : null}
        </View>

        {status ? <Text style={styles.status}>{status}</Text> : null}

        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {screen === 'welcome' ? renderWelcome() : null}
          {screen === 'auth' ? renderAuth() : null}
          {screen === 'membership' ? renderMembership() : null}
          {screen === 'coach' ? renderCoachSelection() : null}
          {screen === 'chat' ? renderChat() : null}
          {screen === 'settings' ? renderSettings() : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )

  function renderWelcome() {
    return (
      <View style={styles.card}>
        <Text style={styles.eyebrow}>Emotional support, not therapy</Text>
        <Text style={styles.title}>Support for difficult nights.</Text>
        <Text style={styles.copy}>
          Choose a coach, get grounded, tell the truth, and make one better decision without pretending this is therapy,
          diagnosis, or emergency care.
        </Text>
        <PrimaryButton label="Sign in" onPress={() => setScreen('auth')} />
        <SecondaryButton label="Start free trial" onPress={() => setScreen(token ? 'membership' : 'auth')} />
        <Text style={styles.safety}>
          If you may hurt yourself or someone else, call local emergency services now. In the US and Canada, call or text 988.
        </Text>
      </View>
    )
  }

  function renderAuth() {
    return (
      <View style={styles.card}>
        <Text style={styles.title}>Sign in with email.</Text>
        <TextInput
          style={styles.input}
          autoCapitalize="none"
          keyboardType="email-address"
          placeholder="you@example.com"
          value={email}
          onChangeText={setEmail}
        />
        {authStep === 'verify' ? (
          <TextInput
            style={styles.input}
            keyboardType="number-pad"
            placeholder="6-digit code"
            value={code}
            onChangeText={setCode}
          />
        ) : null}
        {devCode ? <Text style={styles.devCode}>Dev code: {devCode}</Text> : null}
        <PrimaryButton label={authStep === 'verify' ? 'Verify and continue' : 'Send code'} onPress={authStep === 'verify' ? verifyCode : requestCode} />
        {authStep === 'verify' ? <SecondaryButton label="Use a different email" onPress={() => setAuthStep('request')} /> : null}
      </View>
    )
  }

  function renderMembership() {
    return (
      <View style={styles.card}>
        <Text style={styles.eyebrow}>Membership</Text>
        <Text style={styles.title}>One week free trial.</Text>
        <Text style={styles.price}>Then $19/month</Text>
        <Bullet text="Includes Coach W, Coach H, and Coach O" />
        <Bullet text="Saved chat history and coach-specific memory" />
        <Bullet text="Text chat, voice input, and coach reply playback" />
        <PrimaryButton label="Start free trial" onPress={beginCheckout} />
        <SecondaryButton label="Refresh membership" onPress={() => refreshStatus()} />
        <Text style={styles.muted}>Current status: {subscriptionStatus}</Text>
        <Text style={styles.safety}>Purchases may open in a secure browser checkout. App store payment rules should be reviewed before launch.</Text>
      </View>
    )
  }

  function renderCoachSelection() {
    return (
      <View style={styles.card}>
        <Text style={styles.title}>Choose your coach.</Text>
        {coaches.map((coach) => (
          <Pressable
            key={coach.id}
            style={[styles.coachCard, selectedCoachId === coach.id && styles.coachCardSelected]}
            onPress={() => chooseCoach(coach.id)}
          >
            <Text style={styles.coachName}>{coach.name}</Text>
            <Text style={styles.coachTone}>{coach.tone}</Text>
            <Text style={styles.copy}>{coach.bestFor}</Text>
          </Pressable>
        ))}
      </View>
    )
  }

  function renderChat() {
    return (
      <View style={styles.chatShell}>
        <View style={styles.chatHeader}>
          <View>
            <Text style={styles.eyebrow}>Active coach</Text>
            <Text style={styles.coachName}>{selectedCoach.name}</Text>
            <Text style={styles.coachTone}>{selectedCoach.tone}</Text>
          </View>
          <Pressable style={styles.smallButton} onPress={() => setScreen('coach')}>
            <Text style={styles.smallButtonText}>Change</Text>
          </Pressable>
        </View>

        {messages.length ? (
          messages.map((message, index) => (
            <View key={`${message.role}-${index}`} style={[styles.message, message.role === 'user' ? styles.userMessage : styles.assistantMessage]}>
              <Text style={styles.messageLabel}>{message.label || (message.role === 'user' ? 'You' : selectedCoach.name)}</Text>
              <Text style={[styles.messageText, message.role === 'user' && styles.userMessageText]}>{message.text}</Text>
              {message.escalated ? <Text style={styles.crisisText}>Urgent human help recommended.</Text> : null}
            </View>
          ))
        ) : (
          <Text style={styles.empty}>No messages yet. Start with what is happening right now.</Text>
        )}

        <View style={styles.promptRow}>
          {quickPrompts.map((prompt) => (
            <Pressable key={prompt} style={styles.promptPill} onPress={() => sendMessage(prompt)}>
              <Text style={styles.promptText}>{prompt}</Text>
            </Pressable>
          ))}
        </View>

        <TextInput
          style={[styles.input, styles.textArea]}
          multiline
          placeholder="Type what you need help with..."
          value={draft}
          onChangeText={setDraft}
        />
        <View style={styles.actionRow}>
          <Pressable style={[styles.voiceButton, listening && styles.voiceButtonActive]} onPress={listening ? stopListening : startListening}>
            <Text style={styles.voiceButtonText}>{listening ? 'Stop' : 'Mic'}</Text>
          </Pressable>
          <Pressable style={styles.voiceButton} onPress={speakLastReply}>
            <Text style={styles.voiceButtonText}>Play</Text>
          </Pressable>
          <Pressable style={[styles.button, styles.sendButton]} onPress={() => sendMessage()} disabled={sending}>
            <Text style={styles.buttonText}>{sending ? 'Sending...' : 'Send'}</Text>
          </Pressable>
        </View>
      </View>
    )
  }

  function renderSettings() {
    return (
      <View style={styles.card}>
        <Text style={styles.title}>Settings</Text>
        <Text style={styles.copy}>Signed in as {email || 'your account'}</Text>
        <SecondaryButton label="Change coach" onPress={() => setScreen('coach')} />
        <SecondaryButton label="Manage billing" onPress={openBillingPortal} />
        <SecondaryButton label="Open website" onPress={() => Linking.openURL('https://www.sentryharbor.com')} />
        <SecondaryButton label="Sign out" onPress={signOut} />
        <Text style={styles.safety}>Sentryharbor is emotional support, not therapy, diagnosis, or emergency care.</Text>
      </View>
    )
  }
}

function PrimaryButton({ label, onPress }) {
  return (
    <Pressable style={styles.button} onPress={onPress}>
      <Text style={styles.buttonText}>{label}</Text>
    </Pressable>
  )
}

function SecondaryButton({ label, onPress }) {
  return (
    <Pressable style={styles.secondaryButton} onPress={onPress}>
      <Text style={styles.secondaryButtonText}>{label}</Text>
    </Pressable>
  )
}

function Bullet({ text }) {
  return <Text style={styles.bullet}>• {text}</Text>
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: '#f4ece6',
  },
  flex: {
    flex: 1,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 18,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(23, 19, 17, 0.08)',
  },
  logo: {
    width: 52,
    height: 52,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#5d2847',
    shadowColor: '#5d2847',
    shadowOpacity: 0.28,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
  },
  logoText: {
    color: '#fff7f0',
    fontSize: 24,
    fontWeight: '900',
  },
  brand: {
    fontSize: 22,
    fontWeight: '900',
    color: '#171311',
  },
  tagline: {
    color: '#685d57',
    marginTop: 2,
  },
  content: {
    padding: 18,
    paddingBottom: 40,
  },
  card: {
    backgroundColor: 'rgba(255, 250, 247, 0.92)',
    borderRadius: 28,
    padding: 22,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.72)',
    gap: 14,
  },
  chatShell: {
    gap: 14,
  },
  chatHeader: {
    backgroundColor: 'rgba(255, 250, 247, 0.92)',
    borderRadius: 24,
    padding: 18,
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
  },
  eyebrow: {
    color: '#9b315f',
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  title: {
    fontSize: 34,
    lineHeight: 38,
    letterSpacing: -1,
    fontWeight: '900',
    color: '#171311',
  },
  price: {
    fontSize: 24,
    fontWeight: '900',
    color: '#9b315f',
  },
  copy: {
    color: '#685d57',
    lineHeight: 22,
    fontSize: 15,
  },
  muted: {
    color: '#685d57',
  },
  safety: {
    color: '#685d57',
    lineHeight: 20,
    fontSize: 13,
    marginTop: 6,
  },
  status: {
    marginHorizontal: 18,
    marginTop: 8,
    padding: 12,
    borderRadius: 16,
    color: '#5d2847',
    backgroundColor: 'rgba(255, 255, 255, 0.72)',
    overflow: 'hidden',
  },
  input: {
    minHeight: 52,
    borderRadius: 18,
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: 'rgba(23, 19, 17, 0.1)',
    color: '#171311',
  },
  textArea: {
    minHeight: 96,
    textAlignVertical: 'top',
  },
  button: {
    minHeight: 52,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 18,
    backgroundColor: '#9b315f',
  },
  buttonText: {
    color: '#fff',
    fontWeight: '900',
  },
  secondaryButton: {
    minHeight: 50,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 18,
    borderWidth: 1,
    borderColor: 'rgba(23, 19, 17, 0.1)',
    backgroundColor: 'rgba(255, 255, 255, 0.6)',
  },
  secondaryButtonText: {
    color: '#171311',
    fontWeight: '800',
  },
  smallButton: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 999,
    backgroundColor: 'rgba(255, 255, 255, 0.68)',
  },
  smallButtonText: {
    color: '#171311',
    fontWeight: '800',
  },
  devCode: {
    padding: 10,
    borderRadius: 12,
    backgroundColor: '#fff5e5',
    color: '#9b315f',
    fontWeight: '800',
  },
  bullet: {
    color: '#171311',
    lineHeight: 22,
    fontWeight: '700',
  },
  coachCard: {
    padding: 16,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(23, 19, 17, 0.08)',
    backgroundColor: 'rgba(255,255,255,0.68)',
    gap: 6,
  },
  coachCardSelected: {
    borderColor: '#9b315f',
    backgroundColor: '#fff4f0',
  },
  coachName: {
    fontSize: 18,
    fontWeight: '900',
    color: '#171311',
  },
  coachTone: {
    color: '#9b315f',
    fontWeight: '800',
  },
  message: {
    padding: 14,
    borderRadius: 20,
    gap: 6,
  },
  userMessage: {
    marginLeft: 32,
    backgroundColor: '#9b315f',
  },
  assistantMessage: {
    marginRight: 32,
    backgroundColor: '#fffaf7',
    borderWidth: 1,
    borderColor: 'rgba(23, 19, 17, 0.08)',
  },
  messageLabel: {
    fontWeight: '900',
    color: '#f6c64f',
  },
  messageText: {
    color: '#171311',
    lineHeight: 21,
  },
  userMessageText: {
    color: '#fff7f0',
  },
  crisisText: {
    color: '#b42318',
    fontWeight: '900',
  },
  empty: {
    color: '#685d57',
    textAlign: 'center',
    padding: 20,
  },
  promptRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  promptPill: {
    paddingVertical: 9,
    paddingHorizontal: 12,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.72)',
  },
  promptText: {
    color: '#171311',
    fontWeight: '700',
  },
  actionRow: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'center',
  },
  voiceButton: {
    minHeight: 52,
    minWidth: 64,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#251a1e',
  },
  voiceButtonActive: {
    backgroundColor: '#ea5e39',
  },
  voiceButtonText: {
    color: '#fff7f0',
    fontWeight: '900',
  },
  sendButton: {
    flex: 1,
  },
})
