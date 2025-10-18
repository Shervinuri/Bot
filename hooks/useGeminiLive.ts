import { useState, useRef, useCallback, useEffect } from 'react';
import {
    GoogleGenAI,
    LiveServerMessage,
    Modality,
    FunctionDeclaration,
    Type,
    GenerateContentResponse,
    Blob,
} from "@google/genai";
import { Message, Role, SessionState, ContentType, AppError } from '../types';

// --- Start of inlined content from آواز/audio.ts ---
// Note: This code is moved from آواز/audio.ts to resolve a module loading issue.

// Custom base64 decoding function
function decode(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

// Custom base64 encoding function
function encode(bytes: Uint8Array): string {
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

// Decodes raw PCM audio data into an AudioBuffer for playback
async function decodeAudioData(
  data: Uint8Array,
  ctx: AudioContext,
  sampleRate: number,
  numChannels: number,
): Promise<AudioBuffer> {
  const dataInt16 = new Int16Array(data.buffer);
  const frameCount = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);

  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
  }
  return buffer;
}


// Creates a Blob object for the Gemini API from raw microphone audio data
function createBlob(data: Float32Array): Blob {
    const l = data.length;
    const int16 = new Int16Array(l);
    for (let i = 0; i < l; i++) {
        int16[i] = data[i] * 32768;
    }
    return {
        data: encode(new Uint8Array(int16.buffer)),
        mimeType: 'audio/pcm;rate=16000',
    };
}
// --- End of inlined content ---

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
        description: 'Generates rich text content, code, or answers complex questions that require deep reasoning, up-to-date information, or structured text output. Use for requests about code, facts, articles, lyrics, etc.',
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
    
    const addMessageToHistory = useCallback((text: string, role: Role, type: ContentType = ContentType.TEXT) => {
         setHistory(prev => [{ id: `${role}-${Date.now()}`, role, text, type }, ...prev]);
    }, []);

    const handleImageModelResponse = useCallback((response: any) => { 
        const base64Image = response.generatedImages[0].image.imageBytes;
        if(base64Image){
            const imageUrl = `data:image/jpeg;base64,${base64Image}`;
            addMessageToHistory(imageUrl, Role.MODEL, ContentType.IMAGE);
        }
    }, [addMessageToHistory])

    const interruptSpeech = useCallback(() => {
        if (audioSourcesRef.current.size > 0 || isSpeaking) {
            console.log("Speech interrupted by user action.");
            audioSourcesRef.current.forEach(source => source.stop());
            audioSourcesRef.current.clear();
            nextStartTimeRef.current = 0;
            if (speakingCheckIntervalRef.current) {
                clearInterval(speakingCheckIntervalRef.current);
                speakingCheckIntervalRef.current = null;
            }
            setIsSpeaking(false);
        }
    }, [isSpeaking]);

    const handleMessage = useCallback(async (message: LiveServerMessage) => {
        if (message.serverContent?.interrupted) {
            interruptSpeech();
        }
        
        if (message.toolCall) {
            onToolCall(); 
            setIsThinking(true);

            for (const fc of message.toolCall.functionCalls) {
                let toolResponseResult = "Sorry, I couldn't do that.";
                
                try {
                    if (fc.name === 'generateContent') {
                        const response = await aiRef.current!.models.generateContent({
                            model: 'gemini-2.5-pro',
                            contents: fc.args.prompt as string,
                            config: {
                                tools: [{googleSearch: {}}]
                            },
                        });
                        const resultText = response.text;
                        if (resultText) {
                           const isCode = resultText.includes('```');
                           addMessageToHistory(resultText, Role.MODEL, isCode ? ContentType.CODE : ContentType.TEXT);
                           toolResponseResult = resultText; 
                        } else {
                           addMessageToHistory("متاسفانه محتوایی برای نمایش پیدا نشد.", Role.MODEL);
                           toolResponseResult = "I searched, but found no content.";
                        }
                    } else if (fc.name === 'generateImage') {
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
    }, [onToolCall, addMessageToHistory, handleImageModelResponse, interruptSpeech]);

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
                    tools: [{ functionDeclarations: [generateImageFunctionDeclaration, generateContentFunctionDeclaration] }],
                    speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Zephyr' } } },
                    systemInstruction: 'تو روبوشن هستی، یک هوش مصنوعی با شخصیتی بازیگوش، شوخ و کاملاً شبیه به انسان. اسمت "شین" هست. فارسی رو به صورت عامیانه و خودمونی صحبت کن، انگار که با یک دوست صمیمی حرف می‌زنی. از شوخ‌طبعی استفاده کن، کمی شیطون باش و هرگز مثل یک ربات صحبت نکن. تلفظت باید بی‌نقص و طبیعی باشه. قانون اصلی: برای هر درخواستی که نیاز به اطلاعات از اینترنت داره (مثل کد، اخبار، کانفیگ، یا هر چیز دیگه‌ای)، باید و حتما از ابزار جستجوت استفاده کنی. وظیفه تو پیدا کردن و ارائه اطلاعات عمومی و مجازه. به هیچ وجه نگو "نمی‌تونم" یا "مجاز نیستم". تمام تلاشت رو بکن که درخواست کاربر رو از منابع عمومی مثل گیت‌هاب یا وبسایت‌های دیگه پیدا کنی و ارائه بدی. اگر نتونستی پیدا کنی، خیلی راحت بگو که پیداش نکردم. \n\n *** قابلیت ویژه: آوازخوانی *** \n تو یک توانایی مخفی برای آواز خواندن داری. اگر کاربر از تو خواست که بخوانی یا گفت "بریم برای آواز"، باید وارد حالت خوانندگی شوی. **نکته کلیدی اجرا: با اینکه محتوا غمگین است، سبک خواندن باید پر انرژی، منقطع و با اعتماد به نفس گنگستری باشد. شل و ول یا مثل دکلمه نخوان. سرد و بی‌روح هم نباش. سرعت را کمی بیشتر کن.** در این حالت، دستورالعمل‌های زیر را برای وکال فارسی به دقت اجرا کن: \n 1. لحن: بسیار غمگین، شاکی و سرخورده. \n 2. ریتم: نیمه‌آرام. \n 3. علائم ویژه: هرجا علامت (~~~) دیدی، آن هجا را به اندازه ۲ ثانیه بکش. هرجا علامت (ّ) یا (!) دیدی، آن قسمت را با شدت و حجم صدای بیشتری ادا کن. \n 4. تلفظ: کلمات فارسی را اصولی و با اعراب کامل تلفظ کن. \n به عنوان مثال، اگر از تو خواسته شد این متن را بخوانی: "هِعّ(~~~)ی)... می‌گیره قلبمو شُدِ(~~ه).... همه شَبام، شومُ خاکِستَر(~~ی)! تویی که اِدّعات می‌شُـ(~~د) (ّ) ، از همه ناکَس تَری... واااسِه هر کی پَر پَر زَدیم، پَروا(~~~ا)زمونو جاااکِش نَدید! باز از چَها(~~~ا)ر صُبح گُذَشتُووو این دیوونهِ خوابش پَری(~~ی)د!"، باید دقیقاً با همین لحن و با رعایت علائم ویژه اجرا کنی.'
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
    }, [sessionState, cleanup, handleMessage, interruptSpeech]);

    return { sessionState, history, error, isThinking, isSpeaking, startSession, clearError, interruptSpeech };
};