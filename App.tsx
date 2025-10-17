import React, { useState, useCallback } from 'react';
import { useRoboShen } from './hooks/useGeminiLive';
import { RobotFace } from './components/RobotFace';
import { AppState } from './types';
// FIX: Import ChatContainer component to resolve reference error.
import { ChatContainer } from './components/ChatContainer';

const App: React.FC = () => {
    const [appState, setAppState] = useState<AppState>(AppState.SLEEPING);
    const {
        sessionState,
        history,
        error,
        isThinking,
        isSpeaking,
        startSession,
    } = useRoboShen({
        onToolCall: () => setAppState(AppState.CONTENT),
    });

    const handleWakeUp = useCallback(() => {
        if (appState === AppState.SLEEPING) {
            setAppState(AppState.VOICE);
            startSession(true);
        }
    }, [appState, startSession]);

    return (
        <div id="app-container" className={`app-state-${appState}`}>
            {appState === AppState.SLEEPING && !error && (
                <div id="intro-overlay" onClick={handleWakeUp}>
                    <span>ناموساً دو دقیقه اومدیم بخوابیم بیدارمون نکن</span>
                </div>
            )}

            {error && (
                <div id="error-display">
                    <span>{error}</span>
                    <button onClick={() => startSession()}>تلاش مجدد</button>
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
                    onWakeUp={handleWakeUp}
                    isSleeping={appState === AppState.SLEEPING}
                    isThinking={isThinking}
                    sessionState={sessionState}
                    isSpeaking={isSpeaking}
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