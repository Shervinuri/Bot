import React, { useState, useCallback } from 'react';
import { useRoboShen } from './hooks/useGeminiLive';
import { RobotFace } from './components/RobotFace';
import { AppState, SessionState } from './types';
import { ChatContainer } from './components/ChatContainer';

const IntroOverlay: React.FC<{ onStart: () => void }> = ({ onStart }) => (
    <div id="intro-overlay" onClick={onStart}>
        <div className="intro-content">
            <h2>به RoboShen خوش آمدید</h2>
            <p>برای شروع گفتگو، روی صفحه کلیک کنید.</p>
            <p className="permission-notice">
                با کلیک کردن، به RoboShen اجازه دسترسی به میکروفون خود را می‌دهید.
            </p>
        </div>
    </div>
);

const App: React.FC = () => {
    const [appState, setAppState] = useState<AppState>(AppState.VOICE);
    const {
        sessionState,
        history,
        error,
        isThinking,
        isSpeaking,
        startSession,
        clearError,
        interruptSpeech,
    } = useRoboShen({
        onToolCall: () => setAppState(AppState.CONTENT),
    });

    const handleRetry = () => {
        clearError();
        // Give UI time to remove error before restarting
        setTimeout(() => startSession(false), 100);
    }

    return (
        <div id="app-container" className={`app-state-${appState}`}>
             {sessionState === SessionState.IDLE && <IntroOverlay onStart={() => startSession(false)} />}

            {error && (
                 <div id="error-overlay">
                    <div id="error-card">
                        <div className="error-header">
                            <h3>{error.title}</h3>
                            <button className="dismiss-btn" onClick={clearError}>&times;</button>
                        </div>
                        <div className="error-body">
                            <p>{error.message}</p>
                            {error.steps && error.steps.length > 0 && (
                                <div className="troubleshooting">
                                    <h4>راهکارهای پیشنهادی:</h4>
                                    <ul>
                                        {error.steps.map((step, index) => (
                                            <li key={index}>{step}</li>
                                        ))}
                                    </ul>
                                </div>
                            )}
                        </div>
                        <div className="error-footer">
                            <button className="retry-btn" onClick={handleRetry}>تلاش مجدد</button>
                        </div>
                    </div>
                </div>
            )}

            <div id="rotate-overlay">
                <div>
                    <h2>لطفاً دستگاه خود را به حالت عمودی بچرخانید</h2>
                    <p>این صفحه برای نمایش عمودی بهینه شده است.</p>
                </div>
            </div>

            <div id="robot-wrapper">
                <RobotFace
                    isSleeping={appState === AppState.SLEEPING}
                    isThinking={isThinking}
                    sessionState={sessionState}
                    isSpeaking={isSpeaking}
                    onInterrupt={interruptSpeech}
                />
            </div>
            
            <div id="chat-container-wrapper">
                {/* The container is always rendered for smoother CSS transitions */}
                <ChatContainer history={history} />
            </div>
            
            <footer className="footer">Exclusive ☬ SHΞN™</footer>
        </div>
    );
};

export default App;