import React, { useState } from 'react';
import { Message, Role, ContentType } from '../types';

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


interface ChatBubbleProps {
    message: Message;
}

const ChatBubble: React.FC<ChatBubbleProps> = ({ message }) => {
    const renderMessageContent = () => {
        switch (message.type) {
            case ContentType.IMAGE:
                return <img src={message.text} alt="Generated content" />;
            case ContentType.CODE:
                return <CodeBlock code={message.text} />;
            case ContentType.TEXT:
            default:
                // The existing CSS for `.message` handles styling, so a simple element is fine.
                // Using a div instead of p to avoid default margins.
                return <div>{message.text}</div>;
        }
    };

    return (
        <div
            className={`message ${message.role === Role.USER ? 'user' : 'bot'}`}
        >
            {renderMessageContent()}
        </div>
    );
};

export default ChatBubble;
