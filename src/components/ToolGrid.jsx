import React from 'react';
import { Brush, Circle, Image, Lightbulb, Move, Plus, Ruler, Shapes, Square, Triangle } from 'lucide-react';

export function ToolGrid({ value, onChange }) {
  const tools = [
    ['select', <Move size={17} />, 'Select and move'],
    ['background', <Image size={17} />, 'Move background'],
    ['token', <Plus size={17} />, 'Place token'],
    ['ruler', <Ruler size={17} />, 'Ruler'],
    ['draw', <Brush size={17} />, 'Freehand'],
    ['light', <Lightbulb size={17} />, 'Reveal lighting area'],
    ['shape', <Shapes size={17} />, 'Rectangle'],
    ['square', <Square size={17} />, 'Square area'],
    ['circle', <Circle size={17} />, 'Circle area'],
    ['cone', <Triangle size={17} />, 'Cone area'],
  ];
  return (
    <div className="tool-grid">
      {tools.map(([id, icon, label]) => (
        <button key={id} title={label} aria-label={label} className={value === id ? 'active' : ''} onClick={() => onChange(id)}>
          {icon}
        </button>
      ))}
    </div>
  );
}
