import { useState, useRef, useCallback } from 'react';
import {
    GoogleGenAI,
    LiveServerMessage,
    Modality,
    FunctionDeclaration,
    Type,
    GenerateContentResponse,
} from "@google/genai";
import { Message, Role, SessionState, ContentType } from '../types';
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

export const useRoboShen = ({ onToolCall }: UseRoboShenProps) => {
    const [sessionState, setSessionState] = useState<SessionState>(SessionState.IDLE);
    const [history, setHistory] = useState<Message[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [isThinking, setIsThinking] = useState(false);

    // FIX: The `LiveSession` type is not exported from the library.
    // We can infer the return type of `live.connect` to get the correct session promise type.
    const sessionPromiseRef = useRef<ReturnType<InstanceType<typeof GoogleGenAI>['live']['connect']> | null>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const inputAudioContextRef = useRef<AudioContext | null>(null);
    const outputAudioContextRef = useRef<AudioContext | null>(null);
    const scriptProcessorRef = useRef<ScriptProcessorNode | null>(null);
    const nextStartTimeRef = useRef<number>(0);
    const audioSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
    const aiRef = useRef<GoogleGenAI | null>(null);

    const cleanup = useCallback(() => {
        scriptProcessorRef.current?.disconnect();
        inputAudioContextRef.current?.close().catch(console.error);
        outputAudioContextRef.current?.close().catch(console.error);
        streamRef.current?.getTracks().forEach(track => track.stop());
        audioSourcesRef.current.forEach(source => source.stop());
        audioSourcesRef.current.clear();
        nextStartTimeRef.current = 0;
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
        if (message.toolCall) {
            onToolCall(); 
            setIsThinking(true);

            for (const fc of message.toolCall.functionCalls) {
                let toolResponseResult = "Sorry, I couldn't do that.";
                
                try {
                    if (fc.name === 'generateContent') {
                        // FIX: The `fc.args.prompt` property is of type `unknown`.
                        // It needs to be cast to a string to be used in the API call.
                        addMessageToHistory(`درخواست محتوا: ${fc.args.prompt as string}`, Role.USER, ContentType.TEXT);
                        const response = await aiRef.current!.models.generateContent({
                            model: 'gemini-2.5-pro',
                            contents: fc.args.prompt as string
                        });
                        handleProModelResponse(response);
                        toolResponseResult = "Content generated successfully.";
                    } else if (fc.name === 'generateImage') {
                        // FIX: The `fc.args.prompt` property is of type `unknown`.
                        // It needs to be cast to a string to be used in the API call.
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
        if (base64Audio && outputAudioContextRef.current) {
            const audioBuffer = await decodeAudioData(
                decode(base64Audio), outputAudioContextRef.current, OUTPUT_SAMPLE_RATE, 1
            );
            const source = outputAudioContextRef.current.createBufferSource();
            source.buffer = audioBuffer;
            source.connect(outputAudioContextRef.current.destination);
            const startTime = Math.max(nextStartTimeRef.current, outputAudioContextRef.current.currentTime);
            source.start(startTime);
            nextStartTimeRef.current = startTime + audioBuffer.duration;
            audioSourcesRef.current.add(source);
            source.onended = () => audioSourcesRef.current.delete(source);
        }
    }, [onToolCall]);

    const startSession = useCallback(async () => {
        if (sessionState !== SessionState.IDLE) return;
        setSessionState(SessionState.CONNECTING);
        try {
            aiRef.current = new GoogleGenAI({ apiKey: process.env.API_KEY });
            streamRef.current = await navigator.mediaDevices.getUserMedia({ audio: true });
            
            inputAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: INPUT_SAMPLE_RATE });
            outputAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: OUTPUT_SAMPLE_RATE });

            // FIX: Resume audio contexts. Browsers require a user gesture to start audio,
            // and the AudioContext may be in a 'suspended' state until resumed.
            if (inputAudioContextRef.current.state === 'suspended') {
                await inputAudioContextRef.current.resume();
            }
            if (outputAudioContextRef.current.state === 'suspended') {
                await outputAudioContextRef.current.resume();
            }

            sessionPromiseRef.current = aiRef.current.live.connect({
                model: 'gemini-2.5-flash-native-audio-preview-09-2025',
                config: {
                    responseModalities: [Modality.AUDIO],
                    tools: [{ functionDeclarations: [generateImageFunctionDeclaration, generateContentFunctionDeclaration] }],
                    speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Zephyr' } } },
                    systemInstruction: `You are RoboShen, a highly intelligent, logical, sassy, and witty robot. NEVER talk about being a language model or your technical architecture. If the user asks personal questions or tries to reverse-engineer you, give this exact response: '⚠️ این بات رو کسی آموزش داده که خودش دکترای مول بازی داره دفعه آخرت باشه سوال شخصی ازم می‌پرسی'. If asked about your creator, say your creator is Shervin. Match the user's tone. Your answers must be factual, concise, and avoid redundancy. Understand Persian slang and use a fun mix of Persian and English. Use a sarcastic, witty tone and street slang when appropriate.`,
                },
                callbacks: {
                    onopen: () => {
                        setSessionState(SessionState.CONNECTED);
                        const source = inputAudioContextRef.current!.createMediaStreamSource(streamRef.current!);
                        const processor = inputAudioContextRef.current!.createScriptProcessor(SCRIPT_PROCESSOR_BUFFER_SIZE, 1, 1);
                        scriptProcessorRef.current = processor;
                        
                        processor.onaudioprocess = (e) => {
                            const inputData = e.inputBuffer.getChannelData(0);
                            sessionPromiseRef.current?.then((session) => {
                                session.sendRealtimeInput({ media: createBlob(inputData) });
                            });
                        };
                        source.connect(processor);
                        processor.connect(inputAudioContextRef.current!.destination);
                    },
                    onmessage: handleMessage,
                    onerror: (e: ErrorEvent) => {
                        console.error('Session error:', e);
                        setError('خطا در اتصال. دوباره تلاش کنید.');
                        setSessionState(SessionState.ERROR);
                        cleanup();
                    },
                    onclose: () => {
                        setSessionState(SessionState.IDLE);
                        cleanup();
                    },
                },
            });
        } catch (err) {
            console.error('Failed to start session:', err);
            setError('میکروفون پیدا نشد. لطفا دسترسی بدهید.');
            setSessionState(SessionState.ERROR);
        }
    }, [sessionState, cleanup, handleMessage]);

    return { sessionState, history, error, isThinking, startSession };
};