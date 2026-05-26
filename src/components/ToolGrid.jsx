import React from 'react';
import { BrickWall, Brush, Circle, DoorOpen, Image, Lightbulb, Move, Plus, Ruler, Shapes, Square, Triangle } from 'lucide-react';

export function ToolGrid({ value, onChange }) {
  const toolSections = [
    ['Movement', [
      ['select', <Move size={17} />, 'Select and move'],
      ['background', <Image size={17} />, 'Move background'],
    ]],
    ['Tokens', [
      ['token', <Plus size={17} />, 'Place token'],
    ]],
    ['Drawing', [
      ['draw', <Brush size={17} />, 'Freehand'],
      ['shape', <Shapes size={17} />, 'Rectangle'],
      ['square', <Square size={17} />, 'Square area'],
      ['circle', <Circle size={17} />, 'Circle area'],
      ['cone', <Triangle size={17} />, 'Cone area'],
    ]],
    ['Lighting', [
      ['light', <Lightbulb size={17} />, 'Reveal lighting area. Right-drag to hide revealed light.'],
      ['wall', <BrickWall size={17} />, 'Draw light-blocking wall'],
      ['door', <DoorOpen size={17} />, 'Place interactive door'],
    ]],
    ['Measurements', [
      ['ruler', <Ruler size={17} />, 'Ruler'],
    ]],
  ];
  return (
    <div className="toolbox">
      {toolSections.map(([section, tools]) => (
        <div className="tool-section" key={section}>
          <span>{section}</span>
          <div className="tool-grid">
            {tools.map(([id, icon, label]) => (
              <button key={id} title={label} aria-label={label} className={value === id ? 'active' : ''} onClick={() => onChange(id)}>
                {icon}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
