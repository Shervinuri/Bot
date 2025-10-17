import React, { useRef, useEffect } from 'react';

// This is a safe fallback implementation for a waveform display.
// It is not currently integrated into the main application but is provided
// to prevent build errors and can be used to visualize audio activity.

interface WaveformProps {
    /** When true, the wave becomes more active. */
    isActive?: boolean;
}

const Waveform: React.FC<WaveformProps> = ({ isActive = false }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        let animationFrameId: number;
        let frame = 0;

        const draw = () => {
            frame++;
            const { width, height } = canvas;
            ctx.clearRect(0, 0, width, height);
            
            ctx.lineWidth = 2;
            ctx.strokeStyle = 'var(--eye-color, #00eaff)'; // Use theme color

            ctx.beginPath();
            const centerY = height / 2;
            const amplitude = isActive ? height / 3.5 : 2;
            const frequency = 0.04;
            const speed = 8;

            for (let x = 0; x < width; x++) {
                const y = centerY + amplitude * Math.sin(x * frequency + frame / speed);
                if (x === 0) {
                    ctx.moveTo(x, y);
                } else {
                    ctx.lineTo(x, y);
                }
            }
            ctx.stroke();

            animationFrameId = requestAnimationFrame(draw);
        };

        draw();

        return () => {
            cancelAnimationFrame(animationFrameId);
        };
    }, [isActive]);

    return (
        <canvas 
            ref={canvasRef} 
            width="300" 
            height="60" 
            style={{ display: 'block', width: '100%', height: '100%' }}
        />
    );
};

export default Waveform;
