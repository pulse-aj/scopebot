import { useState, useRef, useEffect } from "react";
import { useLocation, useParams } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { 
  useListConversations, 
  getListConversationsQueryKey,
  useCreateConversation,
  useGetConversation,
  getGetConversationQueryKey,
  useSendMessage,
  useUploadAttachment,
  useFinalizeConversation,
  getListFeatureRequestsQueryKey
} from "@workspace/api-client-react";
import { format } from "date-fns";
import { useDropzone } from "react-dropzone";
import { 
  MessageSquarePlus, 
  Send, 
  Paperclip, 
  CheckCircle2, 
  File, 
  X, 
  Loader2, 
  Bot, 
  User,
  AlertCircle,
  ArrowLeft,
  ShieldCheck,
  Mic,
  Square
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useIsMobile } from "@/hooks/use-mobile";
import { useToast } from "@/hooks/use-toast";
import { Markdown } from "@/components/markdown";

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

export default function ChatPage() {
  const [, setLocation] = useLocation();
  const params = useParams();
  const conversationId = params.id ? parseInt(params.id, 10) : undefined;
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: conversations, isLoading: loadingConversations } = useListConversations();
  const createConv = useCreateConversation();
  const [minor, setMinor] = useState(false);

  const handleNewConversation = () => {
    createConv.mutate({ data: { minor } }, {
      onSuccess: (newConv) => {
        queryClient.invalidateQueries({ queryKey: getListConversationsQueryKey() });
        setLocation(`/app/conversations/${newConv.id}`);
      },
      onError: () => {
        toast({ title: "Failed to create conversation", variant: "destructive" });
      }
    });
  };

  return (
    <div className="flex h-full flex-1 min-w-0 bg-card">
      {/* Conversations Sidebar — full width on mobile when no conversation; fixed width on desktop */}
      <div className={`${conversationId ? "hidden md:flex" : "flex"} w-full md:w-80 border-r border-border flex-col bg-muted/30`}>
        <div className="p-4 border-b border-border">
          <Button 
            onClick={handleNewConversation} 
            disabled={createConv.isPending}
            className="w-full justify-start gap-2 bg-indigo-600 hover:bg-indigo-700 text-white"
          >
            {createConv.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <MessageSquarePlus className="w-4 h-4" />}
            New Conversation
          </Button>
          <label className="mt-3 flex items-start gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={minor}
              onChange={(e) => setMinor(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-border accent-indigo-600 cursor-pointer"
            />
            <span className="text-xs leading-snug text-muted-foreground">
              <span className="font-medium text-foreground/90">Minor request</span>
              {" — a small bug or quick change. I'll ask one quick question, then file it."}
            </span>
          </label>
        </div>
        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {loadingConversations ? (
            <div className="flex justify-center p-4">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground/70" />
            </div>
          ) : conversations?.length === 0 ? (
            <div className="text-center p-4 text-sm text-muted-foreground">
              No conversations yet. Start one to scope a feature!
            </div>
          ) : (
            conversations?.map((conv) => (
              <button
                key={conv.id}
                onClick={() => setLocation(`/app/conversations/${conv.id}`)}
                className={`w-full text-left px-3 py-3 rounded-lg transition-colors flex flex-col gap-1 ${
                  conv.id === conversationId
                    ? "bg-indigo-50 dark:bg-indigo-950/40 border-indigo-100 dark:border-indigo-900/60 border text-indigo-900 dark:text-indigo-100"
                    : "hover:bg-muted border border-transparent text-foreground/85"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium text-sm truncate pr-2">{conv.title || "New feature request"}</span>
                  {conv.status === "finalized" && <CheckCircle2 className="w-3.5 h-3.5 text-green-500 flex-shrink-0" />}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">{format(new Date(conv.updatedAt), "MMM d, yyyy")}</span>
                  {conv.minor && (
                    <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0 rounded bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-400">
                      Minor
                    </span>
                  )}
                </div>
              </button>
            ))
          )}
        </div>
      </div>

      {/* Chat Area — hidden on mobile until a conversation is selected */}
      <div className={`${conversationId ? "flex" : "hidden md:flex"} flex-1 flex-col min-w-0 bg-card`}>
        {conversationId ? (
          <ActiveChat key={conversationId} conversationId={conversationId} onBack={() => setLocation('/app')} />
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground p-8 text-center">
            <div className="w-16 h-16 bg-indigo-100 dark:bg-indigo-950/50 text-indigo-600 dark:text-indigo-400 rounded-full flex items-center justify-center mb-6">
              <Bot className="w-8 h-8" />
            </div>
            <h2 className="text-2xl font-bold text-foreground mb-2">ScopeBot</h2>
            <p className="max-w-md text-muted-foreground">
              Select a conversation from the sidebar or start a new one to begin scoping your next feature.
            </p>
            <Button 
              onClick={handleNewConversation} 
              disabled={createConv.isPending}
              className="mt-6 bg-indigo-600 hover:bg-indigo-700 text-white"
            >
              Start Scoping
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

function ActiveChat({ conversationId, onBack }: { conversationId: number; onBack: () => void }) {
  const { data: conv, isLoading } = useGetConversation(conversationId, {
    query: { enabled: !!conversationId, queryKey: getGetConversationQueryKey(conversationId) }
  });
  
  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<File[]>([]);
  const [pendingMessage, setPendingMessage] = useState<{ content: string; attachmentNames: string[] } | null>(null);
  const [isSending, setIsSending] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isMobile = useIsMobile();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();
  const bottomRef = useRef<HTMLDivElement>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const transcribeAbortRef = useRef<AbortController | null>(null);
  const isUnmountedRef = useRef(false);

  // Stop any in-progress recording when the user navigates away from
  // this conversation so the mic indicator doesn't stay on.
  useEffect(() => {
    return () => {
      // Mark unmounted first so `recorder.onstop` (fired by rec.stop below)
      // bails out instead of kicking off a fresh transcription request.
      isUnmountedRef.current = true;
      const rec = mediaRecorderRef.current;
      if (rec && rec.state !== "inactive") {
        rec.stream.getTracks().forEach((t) => t.stop());
        try { rec.stop(); } catch {}
      }
      // Abort any in-flight transcription so its promise settles instead of
      // leaving the spinner hanging after the user navigates away.
      transcribeAbortRef.current?.abort();
    };
  }, []);

  const startRecording = async () => {
    if (isRecording || isTranscribing) return;
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      toast({ title: "Voice input not supported in this browser", variant: "destructive" });
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // Pick the best supported container/codec. Safari only exposes mp4
      // on iOS/macOS, Chrome/Firefox prefer webm/opus.
      const candidateTypes = [
        "audio/webm;codecs=opus",
        "audio/webm",
        "audio/mp4",
        "audio/ogg;codecs=opus",
      ];
      const mimeType = candidateTypes.find((t) => MediaRecorder.isTypeSupported(t)) || "";
      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);
      audioChunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) audioChunksRef.current.push(e.data);
      };
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(audioChunksRef.current, { type: recorder.mimeType || "audio/webm" });
        audioChunksRef.current = [];
        // If the component unmounted mid-recording, stopping the recorder fired
        // this handler — don't start a request that would outlive the component.
        if (isUnmountedRef.current) return;
        if (blob.size === 0) {
          setIsTranscribing(false);
          return;
        }
        // Bound the request so a stalled upload / dropped connection can't
        // leave the "Transcribing…" spinner running forever. The server aborts
        // its own ElevenLabs call at 60s, so this only fires on a true stall.
        const controller = new AbortController();
        transcribeAbortRef.current = controller;
        const timeoutId = setTimeout(() => controller.abort(), 120_000);
        try {
          const res = await fetch("/api/transcribe", {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": blob.type || "audio/webm" },
            body: blob,
            signal: controller.signal,
          });
          if (!res.ok) {
            const errBody = await res.json().catch(() => ({}));
            const msg = res.status === 503
              ? "Voice transcription isn't configured yet."
              : (errBody as { error?: string }).error || "Transcription failed";
            toast({ title: msg, variant: "destructive" });
            return;
          }
          const data = (await res.json()) as { text: string };
          if (data.text) {
            setInput((prev) =>
              prev.trim().length === 0 ? data.text : `${prev.trimEnd()} ${data.text}`,
            );
          } else {
            toast({ title: "Couldn't hear anything — try again" });
          }
        } catch (err) {
          const isAbort = (err as { name?: string } | null)?.name === "AbortError";
          if (isAbort) {
            // A teardown/unmount abort shouldn't toast — only a genuine timeout.
            if (!isUnmountedRef.current) {
              toast({
                title: "Transcription timed out",
                description: "Long recordings can stall — try a shorter clip.",
                variant: "destructive",
              });
            }
          } else {
            toast({ title: "Transcription failed", variant: "destructive" });
          }
        } finally {
          clearTimeout(timeoutId);
          transcribeAbortRef.current = null;
          setIsTranscribing(false);
        }
      };
      mediaRecorderRef.current = recorder;
      recorder.start();
      setIsRecording(true);
    } catch (err) {
      const msg = err instanceof Error && err.name === "NotAllowedError"
        ? "Microphone permission denied"
        : "Couldn't access the microphone";
      toast({ title: msg, variant: "destructive" });
    }
  };

  const stopRecording = () => {
    const rec = mediaRecorderRef.current;
    if (!rec || rec.state === "inactive") return;
    setIsRecording(false);
    setIsTranscribing(true);
    try { rec.stop(); } catch {}
  };

  const toggleRecording = () => {
    if (isRecording) stopRecording();
    else startRecording();
  };

  const sendMessageMut = useSendMessage();
  const uploadMut = useUploadAttachment();
  const finalizeMut = useFinalizeConversation();

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [conv?.messages, pendingMessage]);

  // Auto-grow the input box as the user types, capped at a max height.
  // On mobile we deliberately DON'T grow it: a tall input pushes the previous
  // message (the question being answered) off-screen. Instead keep it compact
  // and let the textarea scroll internally to the caret.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    if (isMobile) {
      el.style.height = "";
      return;
    }
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [input, isMobile]);

  const onDrop = (acceptedFiles: File[]) => {
    const validFiles = acceptedFiles.filter(f => {
      if (f.size > MAX_FILE_SIZE) {
        toast({ title: `File ${f.name} is too large (max 5MB)`, variant: "destructive" });
        return false;
      }
      return true;
    });
    setAttachments(prev => [...prev, ...validFiles]);
  };

  const { getRootProps, getInputProps, isDragActive } = useDropzone({ 
    onDrop,
    noClick: true,
    noKeyboard: true
  });

  const handleSend = async () => {
    if (!input.trim() && attachments.length === 0) return;
    // Guard against a second send fired during the upload phase (before the
    // send mutation flips isPending) — pendingMessage is a single slot.
    if (isSending) return;

    // Optimistically show the user's message + a typing indicator right away,
    // and clear the composer, instead of waiting for the round-trip.
    const currentInput = input;
    const currentAttachments = attachments;
    setIsSending(true);
    setPendingMessage({
      content: currentInput,
      attachmentNames: currentAttachments.map((f) => f.name),
    });
    setInput("");
    setAttachments([]);

    let attachmentIds: number[] = [];

    if (currentAttachments.length > 0) {
      try {
        for (const file of currentAttachments) {
          const base64 = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.readAsDataURL(file);
            reader.onload = () => resolve((reader.result as string).split(",")[1]);
            reader.onerror = error => reject(error);
          });
          
          const att = await uploadMut.mutateAsync({
            id: conversationId,
            data: {
              filename: file.name,
              mimeType: file.type,
              dataBase64: base64
            }
          });
          attachmentIds.push(att.id);
        }
      } catch (err) {
        toast({ title: "Failed to upload attachments", variant: "destructive" });
        setPendingMessage(null);
        setInput(currentInput);
        setAttachments(currentAttachments);
        setIsSending(false);
        return;
      }
    }

    sendMessageMut.mutate(
      { id: conversationId, data: { content: currentInput, attachmentIds } },
      {
        onSuccess: (newConvData) => {
          queryClient.setQueryData(getGetConversationQueryKey(conversationId), newConvData);
          queryClient.invalidateQueries({ queryKey: getListConversationsQueryKey() });
          setPendingMessage(null);
          setIsSending(false);
        },
        onError: () => {
          toast({ title: "Failed to send message", variant: "destructive" });
          setInput(currentInput);
          setPendingMessage(null);
          setIsSending(false);
        }
      }
    );
  };

  const handleFinalize = () => {
    finalizeMut.mutate({ id: conversationId }, {
      onSuccess: (req) => {
        toast({ title: "Requirements finalized!" });
        queryClient.invalidateQueries({ queryKey: getGetConversationQueryKey(conversationId) });
        queryClient.invalidateQueries({ queryKey: getListConversationsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getListFeatureRequestsQueryKey() });
        // After finalize, conv should be updated, and we can show the link to the feature request.
        setLocation(`/requests/${req.id}`);
      },
      onError: () => {
        toast({ title: "Failed to finalize requirements", variant: "destructive" });
      }
    });
  };

  if (isLoading) {
    return <div className="flex-1 flex items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-indigo-600 dark:text-indigo-400" /></div>;
  }

  if (!conv) {
    return <div className="flex-1 flex items-center justify-center text-muted-foreground">Conversation not found.</div>;
  }

  const isFinalized = conv.status === "finalized";

  return (
    <div className="flex-1 flex flex-col min-h-0 relative" {...getRootProps()}>
      {isDragActive && (
        <div className="absolute inset-0 z-50 bg-indigo-50 dark:bg-indigo-950/90 flex flex-col items-center justify-center backdrop-blur-sm border-2 border-dashed border-indigo-400 m-4 rounded-xl">
          <div className="bg-card p-4 rounded-full shadow-lg mb-4 text-indigo-600 dark:text-indigo-400">
            <Paperclip className="w-8 h-8" />
          </div>
          <p className="text-xl font-semibold text-indigo-900 dark:text-indigo-100">Drop files to attach</p>
          <p className="text-indigo-600 dark:text-indigo-400 mt-2">Images, PDFs, spreadsheets, or docs (max 5MB)</p>
        </div>
      )}
      
      {/* Header */}
      <div className="h-16 flex items-center justify-between gap-2 px-4 md:px-6 border-b border-border bg-card z-10 flex-shrink-0 shadow-sm">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <button
            onClick={onBack}
            className="md:hidden p-2 -ml-2 text-muted-foreground hover:text-foreground rounded-lg hover:bg-muted"
            aria-label="Back to conversations"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h2 className="font-semibold text-foreground truncate">{conv.title || "New Feature Request"}</h2>
          {conv.minor && (
            <span className="flex-shrink-0 text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-400">
              Minor
            </span>
          )}
        </div>
        {isFinalized ? (
          <Button variant="outline" className="gap-2 text-green-700 dark:text-green-300 bg-green-50 dark:bg-green-950/40 border-green-200 dark:border-green-900/60 hover:bg-green-100 dark:bg-green-950/50" onClick={() => conv.featureRequestId && setLocation(`/requests/${conv.featureRequestId}`)}>
            <CheckCircle2 className="w-4 h-4" />
            View Requirements Doc
          </Button>
        ) : (
          <Button 
            onClick={handleFinalize} 
            disabled={finalizeMut.isPending || conv.messages.length < 2}
            className="gap-2 bg-indigo-600 hover:bg-indigo-700 text-white flex-shrink-0"
          >
            {finalizeMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
            <span className="hidden sm:inline">Finalize Requirements</span>
            <span className="sm:hidden">Finalize</span>
          </Button>
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6 bg-muted/40">
        {conv.messages.length === 0 && !pendingMessage ? (
          <div className="h-full flex flex-col items-center justify-center text-center max-w-lg mx-auto">
            <div className="w-12 h-12 bg-indigo-100 dark:bg-indigo-950/50 text-indigo-600 dark:text-indigo-400 rounded-full flex items-center justify-center mb-4">
              <Bot className="w-6 h-6" />
            </div>
            <h3 className="text-xl font-bold text-foreground mb-2">Hello! I'm your ScopeBot.</h3>
            <p className="text-muted-foreground">
              I'm here to help you scope out your feature request. Tell me a bit about what you're trying to achieve, what problem it solves, and how you currently work around it.
            </p>
          </div>
        ) : (
          conv.messages.map(msg => {
            if (msg.role === 'admin') {
              return (
                <div key={msg.id} className="max-w-4xl mx-auto">
                  <div className="flex items-start gap-3 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900/60 rounded-xl p-4 shadow-sm">
                    <div className="w-8 h-8 flex-shrink-0 rounded-full bg-amber-500 text-white flex items-center justify-center">
                      <ShieldCheck className="w-5 h-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-semibold text-amber-800 dark:text-amber-200 mb-1">
                        Question from {msg.authorName || "ScopeBot admin"}
                      </div>
                      <div className="text-foreground">
                        <Markdown content={msg.content} />
                      </div>
                    </div>
                  </div>
                </div>
              );
            }
            return (
            <div key={msg.id} className={`flex gap-4 max-w-4xl mx-auto ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}>
              <div className={`w-8 h-8 flex-shrink-0 rounded-full flex items-center justify-center ${
                msg.role === 'assistant' ? 'bg-indigo-600 text-white' : 'bg-muted text-foreground/85'
              }`}>
                {msg.role === 'assistant' ? <Bot className="w-5 h-5" /> : <User className="w-5 h-5" />}
              </div>
              
              <div className={`flex flex-col gap-2 ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                <div className={`px-5 py-3.5 rounded-2xl max-w-3xl ${
                  msg.role === 'assistant' 
                    ? 'bg-card border border-border text-foreground shadow-sm' 
                    : 'bg-indigo-600 text-white shadow-md'
                }`}>
                  <Markdown content={msg.content} className={msg.role === 'user' ? 'text-white dark:text-white prose-p:text-white prose-headings:text-white' : ''} />
                </div>
                
                {msg.attachments && msg.attachments.length > 0 && (
                  <div className={`flex flex-wrap gap-2 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    {msg.attachments.map(att => (
                      <div key={att.id} className="flex items-center gap-2 bg-card border border-border px-3 py-1.5 rounded-lg shadow-sm text-xs text-muted-foreground">
                        <File className="w-3.5 h-3.5 text-indigo-500" />
                        <span className="truncate max-w-[150px] font-medium">{att.filename}</span>
                        <span className="text-muted-foreground/70">({Math.round(att.sizeBytes / 1024)}kb)</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
            );
          })
        )}

        {/* Optimistic user message + typing indicator while the request is in flight */}
        {pendingMessage && (
          <>
            <div className="flex gap-4 max-w-4xl mx-auto flex-row-reverse">
              <div className="w-8 h-8 flex-shrink-0 rounded-full flex items-center justify-center bg-muted text-foreground/85">
                <User className="w-5 h-5" />
              </div>
              <div className="flex flex-col gap-2 items-end">
                {pendingMessage.content && (
                  <div className="px-5 py-3.5 rounded-2xl max-w-3xl bg-indigo-600 text-white shadow-md">
                    <Markdown content={pendingMessage.content} className="text-white dark:text-white prose-p:text-white prose-headings:text-white" />
                  </div>
                )}
                {pendingMessage.attachmentNames.length > 0 && (
                  <div className="flex flex-wrap gap-2 justify-end">
                    {pendingMessage.attachmentNames.map((name, i) => (
                      <div key={i} className="flex items-center gap-2 bg-card border border-border px-3 py-1.5 rounded-lg shadow-sm text-xs text-muted-foreground">
                        <File className="w-3.5 h-3.5 text-indigo-500" />
                        <span className="truncate max-w-[150px] font-medium">{name}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="flex gap-4 max-w-4xl mx-auto">
              <div className="w-8 h-8 flex-shrink-0 rounded-full flex items-center justify-center bg-indigo-600 text-white">
                <Bot className="w-5 h-5" />
              </div>
              <div className="flex items-center gap-1.5 px-5 py-4 rounded-2xl bg-card border border-border shadow-sm">
                <span className="w-2 h-2 rounded-full bg-muted-foreground/50 animate-bounce [animation-delay:-0.3s]" />
                <span className="w-2 h-2 rounded-full bg-muted-foreground/50 animate-bounce [animation-delay:-0.15s]" />
                <span className="w-2 h-2 rounded-full bg-muted-foreground/50 animate-bounce" />
              </div>
            </div>
          </>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input Area */}
      {isFinalized && (
        <div className="px-4 pt-3 max-w-4xl mx-auto w-full">
          <div className="bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900/60 text-amber-900 dark:text-amber-100 text-sm rounded-lg px-3 py-2">
            This request is finalized. Replies here are folded into the requirements doc — when you answer an admin question, the spec is automatically re-synthesized to incorporate the new context.
          </div>
        </div>
      )}
      <div className="p-4 bg-card border-t border-border shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.05)]">
          <div className="max-w-4xl mx-auto flex flex-col gap-3">
            {attachments.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {attachments.map((file, i) => (
                  <div key={i} className="flex items-center gap-2 bg-indigo-50 dark:bg-indigo-950/40 border border-indigo-100 dark:border-indigo-900/60 px-3 py-1.5 rounded-lg text-xs text-indigo-700 dark:text-indigo-300 font-medium">
                    <File className="w-3.5 h-3.5" />
                    <span className="truncate max-w-[150px]">{file.name}</span>
                    <span className="text-indigo-400">({Math.round(file.size / 1024)}kb)</span>
                    <button 
                      onClick={() => setAttachments(prev => prev.filter((_, idx) => idx !== i))}
                      className="ml-1 text-indigo-400 hover:text-indigo-700 dark:text-indigo-300"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
            
            <div className="relative flex items-end gap-2 bg-muted/40 border border-input rounded-2xl p-2 focus-within:ring-2 focus-within:ring-indigo-500 focus-within:border-transparent transition-all">
              <input {...getInputProps()} id="file-upload" className="hidden" />
              <label htmlFor="file-upload" className="p-2 text-muted-foreground/70 hover:text-indigo-600 dark:text-indigo-400 cursor-pointer transition-colors rounded-xl hover:bg-card flex-shrink-0">
                <Paperclip className="w-5 h-5" />
              </label>
              <button
                type="button"
                onClick={toggleRecording}
                disabled={isTranscribing}
                aria-label={isRecording ? "Stop recording" : "Record voice message"}
                title={isRecording ? "Stop recording" : "Record voice message"}
                className={`p-2 transition-colors rounded-xl flex-shrink-0 ${
                  isRecording
                    ? "text-white bg-red-500 hover:bg-red-600 animate-pulse"
                    : isTranscribing
                      ? "text-indigo-500 bg-card cursor-wait"
                      : "text-muted-foreground/70 hover:text-indigo-600 dark:text-indigo-400 hover:bg-card"
                }`}
              >
                {isTranscribing ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : isRecording ? (
                  <Square className="w-5 h-5" fill="currentColor" />
                ) : (
                  <Mic className="w-5 h-5" />
                )}
              </button>
              
              <Textarea 
                ref={textareaRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
                placeholder="Describe your feature request..."
                className="min-h-[44px] max-h-[200px] border-0 focus-visible:ring-0 shadow-none bg-transparent resize-none py-3 text-base"
                rows={1}
              />
              
              <Button 
                onClick={handleSend}
                disabled={isSending || (!input.trim() && attachments.length === 0)}
                className={`rounded-xl h-11 w-11 p-0 flex items-center justify-center flex-shrink-0 ${isFinalized ? "bg-amber-600 hover:bg-amber-700" : "bg-indigo-600 hover:bg-indigo-700"} text-white shadow-md transition-all disabled:opacity-50`}
              >
                {isSending ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : (
                  <Send className="w-5 h-5" />
                )}
              </Button>
            </div>
            <div className="text-center text-xs text-muted-foreground/70">
              {isRecording
                ? "Recording… tap the stop button when you're done."
                : isTranscribing
                  ? "Transcribing your message…"
                  : "ScopeBot may produce inaccurate information. Press ⌘/Ctrl+Return to send. Tap the mic to dictate."}
            </div>
          </div>
        </div>
    </div>
  );
}