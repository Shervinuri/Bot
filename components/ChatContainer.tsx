import React, { useEffect, useRef, useState } from 'react';
import { Message, Role, ContentType } from '../types';

interface ChatContainerProps {
    history: Message[];
}

const CodeBlock: React.FC<{ code: string }> = ({ code }) => {
    const [isCopied, setIsCopied] = useState(false);
    
    // Simple regex to extract language and code content
    const match = code.match(/```(\w*)\n([\s\S]*?)```/);
    const language = match ? match[1] : 'text';
    const content = match ? match[2] : code;

    const handleCopy = () => {
        navigator.clipboard.writeText(content).then(() => {
            setIsCopied(true);
            setTimeout(() => setIsCopied(false), 2000);
        });
    };

    return (
        <pre>
            <div className="code-header">
                <span>{language}</span>
                <button onClick={handleCopy} className="copy-btn">
                    {isCopied ? 'کپی شد!' : 'کپی'}
                </button>
            </div>
            <code>{content}</code>
        </pre>
    );
};


export const ChatContainer: React.FC<ChatContainerProps> = ({ history }) => {
    const historyRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        // Scroll to the top (latest message) when history changes
        if (historyRef.current) {
            historyRef.current.scrollTop = 0;
        }
    }, [history]);

    const renderMessageContent = (message: Message) => {
        switch (message.type) {
            case ContentType.IMAGE:
                return <img src={message.text} alt="Generated content" />;
            case ContentType.CODE:
                return <CodeBlock code={message.text} />;
            case ContentType.TEXT:
            default:
                return <p>{message.text}</p>;
        }
    };

    return (
        <div id="chat-container">
            <div id="chat-history" ref={historyRef}>
                {history.map((msg) => (
                    <div
                        key={msg.id}
                        className={`message ${msg.role === Role.USER ? 'user' : 'bot'}`}
                    >
                        {renderMessageContent(msg)}
                    </div>
                ))}
            </div>
        </div>
    );
};
