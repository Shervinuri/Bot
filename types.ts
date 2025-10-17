export enum Role {
    USER = 'user',
    MODEL = 'model',
}

export enum ContentType {
    TEXT = 'text',
    IMAGE = 'image',
    CODE = 'code',
}

export interface Message {
    role: Role;
    text: string;
    id: string;
    type: ContentType;
}

export enum SessionState {
    IDLE = 'IDLE',
    CONNECTING = 'CONNECTING',
    CONNECTED = 'CONNECTED',
    ERROR = 'ERROR',
}

export enum AppState {
    SLEEPING = 'sleeping',
    VOICE = 'voice',
    CONTENT = 'content',
}
