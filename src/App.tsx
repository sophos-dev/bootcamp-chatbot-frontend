import { useEffect, useState } from 'react'
import './App.css'
import {
  createConversation,
  getMessages,
  getModels,
  listConversations,
  sendMessageStream,
  type ConversationSummary,
} from './api'
import ChatWindow, { type ChatMessage } from './components/ChatWindow'
import Sidebar from './components/Sidebar'

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'Une erreur est survenue.'
}

export default function App() {
  const [conversations, setConversations] = useState<ConversationSummary[]>([])
  const [activeId, setActiveId] = useState<number | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [draft, setDraft] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Modèles et Rôle Custom
  const [models, setModels] = useState<string[]>([])
  const [selectedModel, setSelectedModel] = useState<string>('')
  const [sendAsNote, setSendAsNote] = useState<boolean>(false)

  // Charger les conversations et la liste des modèles au démarrage
  useEffect(() => {
    listConversations()
      .then((list) => {
        setConversations(list)
        if (list.length > 0) setActiveId(list[0].id)
      })
      .catch((err) => setError(errorMessage(err)))

    getModels()
      .then((availableModels) => {
        setModels(availableModels)
        if (availableModels.length > 0) setSelectedModel(availableModels[0])
      })
      .catch((err) => setError(errorMessage(err)))
  }, [])

  // Charger les messages à l'ouverture d'une conversation
  useEffect(() => {
    if (activeId === null) return
    let cancelled = false
    getMessages(activeId)
      .then((list) => {
        if (!cancelled) setMessages(list.map(({ role, content }) => ({ role, content })))
      })
      .catch((err) => !cancelled && setError(errorMessage(err)))
    return () => {
      cancelled = true
    }
  }, [activeId])

  function selectConversation(id: number) {
    if (loading || id === activeId) return
    setError(null)
    setDraft('')
    setMessages([])
    setActiveId(id)
  }

  async function handleNew() {
    if (loading) return
    setError(null)
    try {
      const id = await createConversation()
      setConversations((list) => [
        { id, created_at: new Date().toISOString(), preview: null },
        ...list,
      ])
      setDraft('')
      setMessages([])
      setActiveId(id)
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  async function handleSend() {
    if (activeId === null || !selectedModel) return
    const text = draft.trim()
    if (!text) return

    const isFirstMessage = messages.length === 0
    const targetRole: 'user' | 'note' = sendAsNote ? 'note' : 'user'

    setError(null)
    setDraft('')
    setLoading(true)

    // 1. Ajout optimiste du message utilisateur ou de la note
    setMessages((list) => [...list, { role: targetRole, content: text }])

    // Si c'est une note, elle n'appelle pas le LLM pour générer une réponse
    if (targetRole === 'note') {
      setLoading(false)
      return
    }

    // 2. Ajout de la bulle vide de l'assistant pour recevoir le flux
    setMessages((list) => [...list, { role: 'assistant', content: '' }])

    try {
      await sendMessageStream(activeId, text, selectedModel, targetRole, (chunk) => {
        setMessages((list) => {
          const updated = [...list]
          const lastIdx = updated.length - 1
          if (lastIdx >= 0 && updated[lastIdx].role === 'assistant') {
            updated[lastIdx] = {
              ...updated[lastIdx],
              content: updated[lastIdx].content + chunk,
            }
          }
          return updated
        })
      })

      if (isFirstMessage) setConversations(await listConversations())
    } catch (err) {
      // En cas d'erreur pendant le flux, retirer la bulle assistant incomplète
      setMessages((list) => list.slice(0, -1))
      setDraft(text)
      setError(errorMessage(err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="app">
      <Sidebar
        conversations={conversations}
        activeId={activeId}
        onSelect={selectConversation}
        onNew={handleNew}
      />
      <main className="main">
        {/* Barre de configuration (Sélection du modèle & option Note) */}
        <div className="toolbar" style={{ padding: '10px 20px', display: 'flex', gap: '20px', alignItems: 'center', background: '#f5f5f5', borderBottom: '1px solid #ddd' }}>
          <div>
            <label htmlFor="model-select" style={{ marginRight: '8px', fontWeight: 'bold' }}>Modèle : </label>
            <select
              id="model-select"
              value={selectedModel}
              onChange={(e) => setSelectedModel(e.target.value)}
              disabled={loading}
            >
              {models.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </div>

          <div>
            <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={sendAsNote}
                onChange={(e) => setSendAsNote(e.target.checked)}
                disabled={loading}
              />
              <span>Envoyer comme <strong>Note personnelle</strong> (non transmise au LLM)</span>
            </label>
          </div>
        </div>

        {error && (
          <div className="error" role="alert">
            {error}
            <button onClick={() => setError(null)} aria-label="Fermer">
              ×
            </button>
          </div>
        )}
        {activeId === null ? (
          <div className="empty">
            <p>Aucune conversation ouverte.</p>
            <button className="new-button" onClick={handleNew}>
              + Nouvelle conversation
            </button>
          </div>
        ) : (
          <ChatWindow
            messages={messages}
            loading={loading}
            draft={draft}
            onDraftChange={setDraft}
            onSend={handleSend}
          />
        )}
      </main>
    </div>
  )
}