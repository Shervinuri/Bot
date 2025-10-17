import React, { useRef, useEffect } from 'react';
import { SessionState } from '../types';

interface RobotFaceProps {
    onWakeUp: () => void;
    isSleeping: boolean;
    isThinking: boolean;
    sessionState: SessionState;
    isSpeaking: boolean;
}

// The original RobotFace class, adapted to be instantiated within a React component
class RobotFaceController {
    canvas: HTMLCanvasElement;
    ctx: CanvasRenderingContext2D;
    W: number;
    H: number;
    onWakeUp: () => void;
    lookX: number = 0;
    lookY: number = 0;
    blinkProgress: number = 1;
    isBlinking: boolean = false;
    lastBlinkTime: number = Date.now();
    currentExpression: string = "neutral";
    expressionTimeout: number | null = null;
    isSleeping: boolean = true;
    isFocusing: boolean = false;
    focusEye: 'left' | 'right' = 'left';
    focusScale: number = 0.65;
    focusProgress: number = 0;
    lastFocusTime: number = Date.now();
    nextFocusDelay: number = 5000 + Math.random() * 5000;
    isThinking: boolean = false;
    isSpeaking: boolean = false;
    hitCount: number = 0;
    isPunished: boolean = false;
    punishmentType: string | null = null;
    punishmentResetTimer: number | null = null;
    animationFrameId: number = 0;


    constructor(canvas: HTMLCanvasElement, onWakeUp: () => void) {
        this.canvas = canvas;
        this.ctx = canvas.getContext("2d")!;
        this.W = canvas.width;
        this.H = canvas.height;
        this.onWakeUp = onWakeUp;
        this.initInteractions();
        this.render();
    }

    render = () => {
        this.ctx.imageSmoothingEnabled = false;
        this.ctx.clearRect(0, 0, this.W, this.H);
        this.drawFaceplate();
        const now = Date.now();
        if (this.isSleeping && !this.isSpeaking) {
            this.drawSleepEyes();
        } else if (this.isThinking) {
            this.drawThinkingEyes(now);
        } else if (this.isPunished && this.punishmentType === 'redEyes') {
            this.drawRedEyes();
        } else {
            // The logic that made the robot fall asleep on its own has been removed.
            // It now stays awake until the isSleeping prop tells it otherwise.
            if (this.currentExpression === 'neutral' && !this.isFocusing && !this.isBlinking && now - this.lastFocusTime > this.nextFocusDelay) this.startFocus();
            if (!this.isBlinking && !this.isFocusing && this.currentExpression === 'neutral' && now - this.lastBlinkTime > 3000 + Math.random() * 2000) this.blink();
            this.drawExpression();
        }
        this.animationFrameId = requestAnimationFrame(this.render);
    }
    
    destroy() {
        cancelAnimationFrame(this.animationFrameId);
        // remove event listeners if they were added to window
    }

    playFlickerAnimation(callback?: () => void) {
        this.isSleeping = false;
        let flickerCount = 0;
        const maxFlickers = 6;
        const flicker = () => {
            if (flickerCount >= maxFlickers) {
                if (callback) callback();
                return;
            }
            this.blinkProgress = Math.random() > 0.3 ? 1 : 0.1;
            flickerCount++;
            setTimeout(flicker, 50 + Math.random() * 50);
        };
        flicker();
    }

    drawFaceplate() { const c = this.ctx, r = 60; c.fillStyle = '#050505'; c.strokeStyle = '#333333'; c.lineWidth = 4; c.beginPath(); c.roundRect(0, 0, this.W, this.H, r); c.fill(); c.stroke() }
    drawExpression() { const eW = 100, eH = 100, eR = 30, eY = this.H / 2 + this.lookY; const lCX = this.W * 0.3 + this.lookX, rCX = this.W * 0.7 + this.lookX; if (this.currentExpression === 'heart') { this.drawPixelHeart(lCX, eY, 80); this.drawPixelHeart(rCX, eY, 80) } else { let lS = 1, rS = 1; if (this.isFocusing) { const s = 1 - (1 - this.focusScale) * this.focusProgress; if (this.focusEye === 'left') lS = s; else rS = s } let verticalScale = 1; if (this.isSpeaking) { const now = Date.now(); const animationSpeed = 250; const animationAmount = 0.08; verticalScale = 1 - Math.abs(Math.sin(now / animationSpeed) * animationAmount) } const cH = eH * this.blinkProgress * verticalScale; this.drawEye(lCX, eY, eW * lS, cH * lS, eR * lS, '#00eaff', 'rgba(0,234,255,0.5)'); this.drawEye(rCX, eY, eW * rS, cH * rS, eR * rS, '#00eaff', 'rgba(0,234,255,0.5)') } }
    drawEye(cx: number, cy: number, w: number, h: number, r: number, co: string, gl: string) { const c = this.ctx; c.shadowBlur = 25; c.shadowColor = gl; c.fillStyle = co; c.beginPath(); c.roundRect(cx - w / 2, cy - h / 2, w, h, r); c.fill(); c.shadowBlur = 0; c.globalCompositeOperation = 'source-atop'; c.fillStyle = 'rgba(0,0,0,0.3)'; for (let i = 0; i < h; i += 3) { c.fillRect(cx - w / 2, cy - h / 2 + i, w, 1.5) } c.globalCompositeOperation = 'source-over' }
    drawRedEyes() { const eW = 110, eH = 110, eR = 35, eY = this.H / 2 + this.lookY; const lCX = this.W * 0.3 + this.lookX, rCX = this.W * 0.7 + this.lookX; this.drawEye(lCX, eY, eW, eH, eR, '#ff1100', 'rgba(255,17,0,0.7)'); this.drawEye(rCX, eY, eW, eH, eR, '#ff1100', 'rgba(255,17,0,0.7)') }
    drawPixelHeart(cx: number, cy: number, s: number) { const b = [[0, 1, 1, 0, 0, 1, 1, 0], [1, 1, 1, 1, 1, 1, 1, 1], [1, 1, 1, 1, 1, 1, 1, 1], [1, 1, 1, 1, 1, 1, 1, 1], [0, 1, 1, 1, 1, 1, 1, 0], [0, 0, 1, 1, 1, 1, 0, 0], [0, 0, 0, 1, 1, 0, 0, 0]]; const pS = s / b[0].length; const tW = pS * b[0].length, tH = pS * b.length; const sX = cx - tW / 2, sY = cy - tH / 2; this.ctx.fillStyle = '#FF99B4'; this.ctx.shadowColor = 'rgba(255,153,180,0.7)'; this.ctx.shadowBlur = 15; b.forEach((r, y) => r.forEach((p, x) => { if (p === 1) this.ctx.fillRect(sX + x * pS, sY + y * pS, pS, pS) })); this.ctx.shadowBlur = 0 }
    drawSleepEyes() { const c = this.ctx, y = this.H / 2, w = 100, h = 12, r = h / 2; c.fillStyle = '#00eaff'; c.shadowColor = 'rgba(0,234,255,0.5)'; c.shadowBlur = 15; c.beginPath(); c.roundRect(this.W * 0.3 - w / 2, y - h / 2, w, h, r); c.roundRect(this.W * 0.7 - w / 2, y - h / 2, w, h, r); c.fill(); c.shadowBlur = 0; }
    drawThinkingEyes(now: number) { const eY = this.H / 2 + this.lookY, lCX = this.W * 0.3 + this.lookX, rCX = this.W * 0.7 + this.lookX, rad = 40; const ang = (now / 500) % (2 * Math.PI);[lCX, rCX].forEach(cx => { this.ctx.strokeStyle = 'rgba(0,234,255,0.7)'; this.ctx.lineWidth = 8; this.ctx.shadowColor = 'rgba(0,234,255,0.7)'; this.ctx.shadowBlur = 15; this.ctx.beginPath(); this.ctx.arc(cx, eY, rad, ang, ang + Math.PI * 1.5); this.ctx.stroke(); this.ctx.shadowBlur = 0 }) }
    startFocus() { if (this.isFocusing) return; this.isFocusing = true; this.focusEye = Math.random() < 0.5 ? 'left' : 'right'; const d = 400, h = 3000; const a = (t: number, s = t, i: 'in' | 'out' = 'in') => { const e = t - s; if (i === 'in') { this.focusProgress = Math.min(1, e / d); if (e >= d) setTimeout(() => requestAnimationFrame(t => a(t, t, 'out')), h); else requestAnimationFrame(t => a(t, s, i)) } else { this.focusProgress = Math.max(0, 1 - (e / d)); if (e >= d) { this.isFocusing = false; this.lastFocusTime = Date.now(); this.nextFocusDelay = 5000 + Math.random() * 5000 } else requestAnimationFrame(t => a(t, s, i)) } }; requestAnimationFrame(a) }
    initInteractions() {
        this.canvas.addEventListener('click', this.handleCanvasClick);
    }
    handleCanvasClick = () => {
        if (this.isSleeping) {
             this.playFlickerAnimation(() => {
                this.onWakeUp();
            });
        }
    }
    wakeUp() { if (this.isSleeping) this.isSleeping = false; }
    blink() { if (this.isBlinking) return; this.isBlinking = true; this.lastBlinkTime = Date.now(); let s: number | null = null; const d = 150; const a = (t: number) => { if (!s) s = t; const e = t - s; if (e < d) this.blinkProgress = 1 - (e / d); else if (e < d * 2) this.blinkProgress = (e - d) / d; else { this.blinkProgress = 1; this.isBlinking = false; return } requestAnimationFrame(a) }; requestAnimationFrame(a) }
    startThinking() { this.wakeUp(); this.isThinking = true }
    stopThinking() { this.isThinking = false }
}


export const RobotFace: React.FC<RobotFaceProps> = ({ onWakeUp, isSleeping, isThinking, sessionState, isSpeaking }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const faceControllerRef = useRef<RobotFaceController | null>(null);

    useEffect(() => {
        if (canvasRef.current) {
            faceControllerRef.current = new RobotFaceController(canvasRef.current, onWakeUp);
        }
        return () => {
            faceControllerRef.current?.destroy();
        }
    }, [onWakeUp]);

    useEffect(() => {
        if (faceControllerRef.current) {
            faceControllerRef.current.isSleeping = isSleeping;
            if (!isSleeping) {
                faceControllerRef.current.wakeUp();
            }
        }
    }, [isSleeping]);

    useEffect(() => {
        if (faceControllerRef.current) {
            if (isThinking) {
                faceControllerRef.current.startThinking();
            } else {
                faceControllerRef.current.stopThinking();
            }
        }
    }, [isThinking]);

    useEffect(() => {
        if (faceControllerRef.current) {
            faceControllerRef.current.isSpeaking = isSpeaking;
            if (isSpeaking) {
                faceControllerRef.current.wakeUp();
            }
        }
    }, [isSpeaking]);

    return (
        <div className="robot-container">
            <div className="robot-frame">
                <canvas ref={canvasRef} id="faceCanvas" width="300" height="300"></canvas>
                <div className="engraved-text">ROBO☬SHΞN™</div>
            </div>
        </div>
    );
};