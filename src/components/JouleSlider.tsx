"use client";

import { useState, useCallback } from "react";

interface JouleSliderProps {
  value?: number;
  onChange?: (value: number) => void;
  onCommit?: (value: number) => void;
  disabled?: boolean;
}

export default function JouleSlider({
  value: controlledValue,
  onChange,
  onCommit,
  disabled = false,
}: JouleSliderProps) {
  const [internalValue, setInternalValue] = useState(3.0);
  const value = controlledValue ?? internalValue;

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const v = parseFloat(e.target.value);
      setInternalValue(v);
      onChange?.(v);
    },
    [onChange]
  );

  const handlePointerUp = useCallback(() => {
    onCommit?.(value);
  }, [onCommit, value]);

  const pct = ((value - 1) / 4) * 100;

  return (
    <div className={`w-full ${disabled ? "opacity-40 pointer-events-none" : ""}`}>
      {/* Score display */}
      <div className="flex items-center justify-center gap-2 mb-3">
        <svg viewBox="0 0 64 87" className="h-5 w-auto">
          <polygon
            points="40,0 14,38 30,38 8,87 55,42 35,42 58,0"
            fill="#ff8a00"
          />
        </svg>
        <span className="text-4xl font-bold tabular-nums text-blue">
          {value.toFixed(1)}
        </span>
        <span className="text-lg text-gray-500">/5</span>
      </div>

      {/* Slider track */}
      <div className="relative h-10 flex items-center">
        {/* Filled track */}
        <div className="absolute inset-x-0 h-2 rounded-full bg-gray-800">
          <div
            className="h-full rounded-full bg-gradient-to-r from-deepblue to-blue transition-all duration-75"
            style={{ width: `${pct}%` }}
          />
        </div>

        {/* Native range input */}
        <input
          type="range"
          min={1}
          max={5}
          step={0.1}
          value={value}
          onChange={handleChange}
          onPointerUp={handlePointerUp}
          onKeyUp={handlePointerUp}
          className="slider-input absolute inset-0 w-full appearance-none bg-transparent cursor-pointer z-10"
          disabled={disabled}
        />

        {/* Bolt thumb (visual only, follows slider) */}
        <div
          className="absolute pointer-events-none z-20 -translate-x-1/2 transition-[left] duration-75"
          style={{ left: `${pct}%` }}
        >
          <div className="relative flex items-center justify-center w-8 h-8 rounded-full bg-card border-2 border-blue shadow-[0_0_12px_rgba(0,212,255,0.4)]">
            <svg viewBox="0 0 64 87" className="h-4 w-auto">
              <polygon
                points="40,0 14,38 30,38 8,87 55,42 35,42 58,0"
                fill="#ff8a00"
              />
            </svg>
          </div>
        </div>
      </div>

      {/* Min/Max labels */}
      <div className="flex justify-between mt-1 text-xs text-gray-600">
        <span>1.0</span>
        <span>5.0</span>
      </div>
    </div>
  );
}
