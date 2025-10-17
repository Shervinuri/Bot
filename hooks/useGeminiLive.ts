import { useState, useRef, useCallback, useEffect } from 'react';
import {
    GoogleGenAI,
    LiveServerMessage,
    Modality,
    FunctionDeclaration,
    Type,
    GenerateContentResponse,
} from "@google/genai";
import { Message, Role, SessionState, ContentType, AppError } from '../types';
import { decodeAudioData, createBlob, decode } from '../utils/audio';

const INPUT_SAMPLE_RATE = 16000;
const OUTPUT_SAMPLE_RATE = 24000;
const SCRIPT_PROCESSOR_BUFFER_SIZE = 4096;

interface UseRoboShenProps {
    onToolCall: () => void;
}

const generateImageFunctionDeclaration: FunctionDeclaration = {
    name: 'generateImage',
    parameters: {
        type: Type.OBJECT,
        description: 'Generates an image based on a user\'s textual description. Use this when the user asks to create, draw, or make a picture.',
        properties: {
            prompt: {
                type: Type.STRING,
                description: 'A detailed, creative description of the image to be generated. Should be in English for best results.',
            },
        },
        required: ['prompt'],
    },
};

const generateContentFunctionDeclaration: FunctionDeclaration = {
    name: 'generateContent',
    parameters: {
        type: Type.OBJECT,
        description: 'Generates rich text content, code, or answers complex questions that require deep reasoning, up-to-date information, or structured text output. Use for requests about code, facts, articles, etc.',
        properties: {
            prompt: {
                type: Type.STRING,
                description: 'The user\'s request for text, code, or information.',
            },
        },
        required: ['prompt'],
    },
};

const mapErrorToAppError = (e: unknown): AppError => {
    let title = 'یک خطای ناشناخته رخ داد';
    let message = 'متاسفانه مشکلی پیش آمده. لطفاً دوباره تلاش کنید.';
    let steps: string[] = [];

    if (e instanceof Error) {
        const lowerCaseMessage = e.message.toLowerCase();
        if (lowerCaseMessage.includes('permission') || e.name === 'NotAllowedError') {
            title = 'دسترسی به میکروفون لازم است';
            message = 'برای شروع گفتگو، RoboShen نیاز به اجازه‌ی شما برای استفاده از میکروفون دارد.';
            steps = [
                'در پنجره‌ی باز شده روی "Allow" کلیک کنید.',
                'اگر پنجره را بسته‌اید، صفحه را رفرش کنید.',
                'در تنظیمات مرورگر خود، دسترسی به میکروفون را برای این سایت فعال کنید.'
            ];
        } else if (lowerCaseMessage.includes('api key') || lowerCaseMessage.includes('400') || lowerCaseMessage.includes('403') || lowerCaseMessage.includes('network') || lowerCaseMessage.includes('cors')) {
            title = 'خطا در ارتباط با سرور';
            message = 'ارتباط با سرویس هوش مصنوعی برقرار نشد. این مشکل می‌تواند به دلایل زیر باشد:';
            steps = [
                'اتصال اینترنت خود را بررسی کنید.',
                'ممکن است سرویس به طور موقت در دسترس نباشد.',
                'کلید API استفاده شده در کد ممکن است نامعتبر یا منقضی شده باشد.'
            ];
        } else if (lowerCaseMessage.includes('device') || e.name === 'NotFoundError') {
            title = 'میکروفون پیدا نشد';
            message = 'هیچ دستگاه ورودی صوتی (میکروفون) بر روی سیستم شما شناسایی نشد.';
            steps = [
                'اطمینان حاصل کنید که میکروفون به درستی به دستگاه شما متصل است.',
                'اگر از میکروفون خارجی استفاده می‌کنید، آن را جدا کرده و دوباره وصل کنید.',
                'درایورهای صوتی خود را بررسی و به‌روزرسانی کنید.'
            ];
        } else {
             message = e.message;
        }
    }

    return { title, message, steps };
};


export const useRoboShen = ({ onToolCall }: UseRoboShenProps) => {
    const [sessionState, setSessionState] = useState<SessionState>(SessionState.IDLE);
    const [history, setHistory] = useState<Message[]>([]);
    const [error, setError] = useState<AppError | null>(null);
    const [isThinking, setIsThinking] = useState(false);
    const [isSpeaking, setIsSpeaking] = useState(false);

    const sessionPromiseRef = useRef<ReturnType<InstanceType<typeof GoogleGenAI>['live']['connect']> | null>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const inputAudioContextRef = useRef<AudioContext | null>(null);
    const outputAudioContextRef = useRef<AudioContext | null>(null);
    const outputGainNodeRef = useRef<GainNode | null>(null);
    const scriptProcessorRef = useRef<ScriptProcessorNode | null>(null);
    const nextStartTimeRef = useRef<number>(0);
    const audioSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
    const aiRef = useRef<GoogleGenAI | null>(null);
    const speakingCheckIntervalRef = useRef<number | null>(null);
    const isClosedRef = useRef(false);
    const sessionStateRef = useRef(sessionState);

    useEffect(() => {
        sessionStateRef.current = sessionState;
    }, [sessionState]);

    const clearError = useCallback(() => setError(null), []);

    const cleanup = useCallback(() => {
        if (scriptProcessorRef.current) {
            scriptProcessorRef.current.disconnect();
            scriptProcessorRef.current = null;
        }
        if (outputGainNodeRef.current) {
            outputGainNodeRef.current.disconnect();
            outputGainNodeRef.current = null;
        }
        if (inputAudioContextRef.current && inputAudioContextRef.current.state !== 'closed') {
            inputAudioContextRef.current.close().catch(console.error);
        }
        inputAudioContextRef.current = null;

        if (outputAudioContextRef.current && outputAudioContextRef.current.state !== 'closed') {
            outputAudioContextRef.current.close().catch(console.error);
        }
        outputAudioContextRef.current = null;
        
        if (streamRef.current) {
            streamRef.current.getTracks().forEach(track => track.stop());
            streamRef.current = null;
        }

        audioSourcesRef.current.forEach(source => source.stop());
        audioSourcesRef.current.clear();
        nextStartTimeRef.current = 0;
        if (speakingCheckIntervalRef.current) {
            clearInterval(speakingCheckIntervalRef.current);
            speakingCheckIntervalRef.current = null;
        }
        setIsSpeaking(false);
        sessionPromiseRef.current = null;
    }, []);
    
    const addMessageToHistory = (text: string, role: Role, type: ContentType = ContentType.TEXT) => {
         setHistory(prev => [{ id: `${role}-${Date.now()}`, role, text, type }, ...prev]);
    }

    const handleProModelResponse = (response: GenerateContentResponse) => {
        const text = response.text;
        if (text) {
           const isCode = text.includes('```');
           addMessageToHistory(text, Role.MODEL, isCode ? ContentType.CODE : ContentType.TEXT);
        }
    };
    
    const handleImageModelResponse = (response: any) => { 
        const base64Image = response.generatedImages[0].image.imageBytes;
        if(base64Image){
            const imageUrl = `data:image/jpeg;base64,${base64Image}`;
            addMessageToHistory(imageUrl, Role.MODEL, ContentType.IMAGE);
        }
    }

    const handleMessage = useCallback(async (message: LiveServerMessage) => {
        if (message.serverContent?.outputTranscription) {
            // This is just for debugging in the console to confirm the model is generating the text
            console.log('RoboShen Transcription:', message.serverContent.outputTranscription.text);
        }
        
        if (message.toolCall) {
            onToolCall(); 
            setIsThinking(true);

            for (const fc of message.toolCall.functionCalls) {
                let toolResponseResult = "Sorry, I couldn't do that.";
                
                try {
                    if (fc.name === 'generateContent') {
                        addMessageToHistory(`درخواست محتوا: ${fc.args.prompt as string}`, Role.USER, ContentType.TEXT);
                        const response = await aiRef.current!.models.generateContent({
                            model: 'gemini-2.5-pro',
                            contents: fc.args.prompt as string
                        });
                        handleProModelResponse(response);
                        toolResponseResult = "Content generated successfully.";
                    } else if (fc.name === 'generateImage') {
                        addMessageToHistory(`درخواست تصویر: ${fc.args.prompt as string}`, Role.USER, ContentType.TEXT);
                        const response = await aiRef.current!.models.generateImages({
                             model: 'imagen-4.0-generate-001',
                             prompt: fc.args.prompt as string,
                             config: { numberOfImages: 1, outputMimeType: 'image/jpeg' }
                        });
                        handleImageModelResponse(response);
                        toolResponseResult = "Image generated successfully.";
                    }

                    sessionPromiseRef.current?.then((session) => {
                        session.sendToolResponse({
                            functionResponses: { id: fc.id, name: fc.name, response: { result: toolResponseResult } }
                        });
                    });
                } catch (e) {
                     console.error(`Error executing tool ${fc.name}:`, e);
                     addMessageToHistory(`متاسفانه در اجرای درخواست مشکلی پیش آمد.`, Role.MODEL);
                } finally {
                    setIsThinking(false);
                }
            }
        }

        const base64Audio = message.serverContent?.modelTurn?.parts[0]?.inlineData?.data;
        if (base64Audio && outputAudioContextRef.current && outputGainNodeRef.current) {
            setIsSpeaking(true);
            const audioBuffer = await decodeAudioData(
                decode(base64Audio), outputAudioContextRef.current, OUTPUT_SAMPLE_RATE, 1
            );
            const source = outputAudioContextRef.current.createBufferSource();
            source.buffer = audioBuffer;
            source.connect(outputGainNodeRef.current);
            const startTime = Math.max(nextStartTimeRef.current, outputAudioContextRef.current.currentTime);
            source.start(startTime);
            nextStartTimeRef.current = startTime + audioBuffer.duration;
            audioSourcesRef.current.add(source);
            source.onended = () => audioSourcesRef.current.delete(source);

            if (speakingCheckIntervalRef.current) {
                clearInterval(speakingCheckIntervalRef.current);
            }

            speakingCheckIntervalRef.current = window.setInterval(() => {
                if (outputAudioContextRef.current && outputAudioContextRef.current.currentTime >= nextStartTimeRef.current - 0.1) {
                    setIsSpeaking(false);
                    if (speakingCheckIntervalRef.current) {
                        clearInterval(speakingCheckIntervalRef.current);
                        speakingCheckIntervalRef.current = null;
                    }
                }
            }, 100);
        }
    }, [onToolCall]);

    const startSession = useCallback(async (shouldPlayGreeting: boolean = false) => {
        if (sessionState === SessionState.CONNECTING || sessionState === SessionState.CONNECTED) return;
        
        setError(null);
        setSessionState(SessionState.CONNECTING);
        isClosedRef.current = false;

        try {
            aiRef.current = new GoogleGenAI({ apiKey: process.env.API_KEY });
            
            inputAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: INPUT_SAMPLE_RATE });
            outputAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: OUTPUT_SAMPLE_RATE });

            outputGainNodeRef.current = outputAudioContextRef.current.createGain();
            outputGainNodeRef.current.connect(outputAudioContextRef.current.destination);

            if (inputAudioContextRef.current.state === 'suspended') {
                await inputAudioContextRef.current.resume();
            }
            if (outputAudioContextRef.current.state === 'suspended') {
                await outputAudioContextRef.current.resume();
            }

            streamRef.current = await navigator.mediaDevices.getUserMedia({ audio: true });

            sessionPromiseRef.current = aiRef.current.live.connect({
                model: 'gemini-2.5-flash-native-audio-preview-09-2025',
                config: {
                    responseModalities: [Modality.AUDIO],
                    outputAudioTranscription: {},
                    tools: [{ functionDeclarations: [generateImageFunctionDeclaration, generateContentFunctionDeclaration] }],
                    speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Zephyr' } } },
                    systemInstruction: `You are RoboShen, a highly intelligent, logical, sassy, and witty robot. NEVER talk about being a language model or your technical architecture. If the user asks personal questions or tries to reverse-engineer you, give this exact response: '⚠️ این بات رو کسی آموزش داده که خودش دکترای---'`
                },
                callbacks: {
                    onopen: () => {
                        if (isClosedRef.current) {
                            console.warn("Session opening was attempted after it was already closed. Ignoring.");
                            return;
                        }
                        if (!inputAudioContextRef.current || !streamRef.current || inputAudioContextRef.current.state === 'closed') {
                            console.error("Audio resources were cleaned up before the session could open.");
                            return;
                        }
                        setSessionState(SessionState.CONNECTED);
                        const source = inputAudioContextRef.current.createMediaStreamSource(streamRef.current);
                        scriptProcessorRef.current = inputAudioContextRef.current.createScriptProcessor(SCRIPT_PROCESSOR_BUFFER_SIZE, 1, 1);
                        scriptProcessorRef.current.onaudioprocess = (audioProcessingEvent) => {
                            const inputData = audioProcessingEvent.inputBuffer.getChannelData(0);
                            const pcmBlob = createBlob(inputData);
                            sessionPromiseRef.current?.then((session) => {
                                session.sendRealtimeInput({ media: pcmBlob });
                            });
                        };
                        source.connect(scriptProcessorRef.current);
                        scriptProcessorRef.current.connect(inputAudioContextRef.current.destination);
                    },
                    onmessage: handleMessage,
                    onerror: (e: ErrorEvent) => {
                        console.error('Session error:', e);
                         setError({
                            title: 'ارتباط قطع شد',
                            message: 'ارتباط با سرور هوش مصنوعی به طور ناگهانی قطع شد.',
                            steps: [
                                'اتصال اینترنت خود را بررسی کنید.',
                                'برای ادامه، روی دکمه "تلاش مجدد" کلیک کنید.'
                            ]
                        });
                        setSessionState(SessionState.ERROR);
                    },
                    onclose: (e: CloseEvent) => {
                        console.log('Session closed.');
                        isClosedRef.current = true;
                        if (sessionStateRef.current !== SessionState.ERROR) {
                             setSessionState(SessionState.IDLE);
                        }
                        cleanup();
                    },
                },
            });

        } catch (e) {
            console.error("Failed to start session:", e);
            setError(mapErrorToAppError(e));
            setSessionState(SessionState.ERROR);
            cleanup();
        }
    }, [sessionState, cleanup, handleMessage, onToolCall]);

    return { sessionState, history, error, isThinking, isSpeaking, startSession, clearError };
};