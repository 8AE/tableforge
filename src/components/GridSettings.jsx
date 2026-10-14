import React, { useEffect, useId, useState } from 'react';
import { normalizeGrid } from '../lib/board';

export function GridSettings({ grid, onChange }) {
  const settings = normalizeGrid(grid);
  const thicknessId = useId();
  const [colorDraft, setColorDraft] = useState(settings.color);
  useEffect(() => setColorDraft(settings.color), [settings.color]);
  const update = (patch) => onChange(normalizeGrid({ ...settings, ...patch }));
  const commitColor = () => {
    if (/^#(?:[\da-f]{3}|[\da-f]{6})$/i.test(colorDraft.trim())) update({ color: colorDraft.trim() });
    else setColorDraft(settings.color);
  };

  return (
    <fieldset className="grid-settings">
      <legend>Grid appearance</legend>
      <div className="grid-settings-visibility">
        <label className="check-row">
          <input type="checkbox" checked={settings.visibleToDm} onChange={(event) => update({ visibleToDm: event.target.checked })} />
          Show in DM view
        </label>
        <label className="check-row">
          <input type="checkbox" checked={settings.visibleToPlayers} onChange={(event) => update({ visibleToPlayers: event.target.checked })} />
          Show in player view
        </label>
      </div>
      <div className="grid-settings-color">
        <label htmlFor={`${thicknessId}-color`}>Grid color</label>
        <span className="grid-settings-color-control">
          <input id={`${thicknessId}-color`} aria-label="Grid color picker" type="color" value={settings.color} onChange={(event) => update({ color: event.target.value })} />
          <input className="grid-settings-color-value" aria-label="Grid color hex" value={colorDraft} maxLength={7} spellCheck={false} onChange={(event) => setColorDraft(event.target.value)} onBlur={commitColor} onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur();
            if (event.key === 'Escape') { setColorDraft(settings.color); event.stopPropagation(); }
          }} />
        </span>
      </div>
      <label className="grid-settings-thickness" htmlFor={thicknessId}>
        <span>Line thickness <output htmlFor={thicknessId}>{settings.thickness} px</output></span>
        <input id={thicknessId} type="range" min="0.5" max="4" step="0.25" value={settings.thickness} aria-valuetext={`${settings.thickness} pixels`} onChange={(event) => update({ thickness: Number(event.target.value) })} />
      </label>
    </fieldset>
  );
}
