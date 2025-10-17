import React, { useState, useCallback } from 'react';
import { useRoboShen } from './hooks/useGeminiLive';
import { RobotFace } from './components/RobotFace';
import { ChatContainer } from './components/ChatContainer';
import { AppState } from './types';

const App: React.FC = () => {
    const [appState, setAppState] = useState<AppState>(AppState.SLEEPING);
    const {
        sessionState,
        history,
        error,
        isThinking,
        startSession,
    } = useRoboShen({
        onToolCall: () => setAppState(AppState.CONTENT),
    });

    const handleWakeUp = useCallback(() => {
        if (appState === AppState.SLEEPING) {
            setAppState(AppState.VOICE);
            startSession();
        }
    }, [appState, startSession]);

    // TODO: Display error state to the user in a more prominent way
    if (error) {
        console.error("Session Error:", error);
    }

    return (
        <div id="app-container" className={`app-state-${appState}`}>
            {appState === AppState.SLEEPING && (
                <div id="intro-overlay" onClick={handleWakeUp}>
                    <span>ناموساً دو دقیقه اومدیم بخوابیم بیدارمون نکن</span>
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