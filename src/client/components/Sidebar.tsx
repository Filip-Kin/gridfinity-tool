import { useRef, useState } from "react";
import { useStore } from "../lib/store";
import type { PlacedStl, PlacedText, GridzMode } from "@shared/types";

function NumField({
  label,
  value,
  onChange,
  step = 1,
  min,
  max,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  step?: number;
  min?: number;
  max?: number;
}) {
  return (
    <div className="field">
      <label>{label}</label>
      <input
        type="number"
        value={value}
        step={step}
        min={min}
        max={max}
        onChange={(e) => {
          const n = parseFloat(e.target.value);
          if (Number.isFinite(n)) onChange(n);
        }}
      />
    </div>
  );
}

function BinConfigPanel() {
  const bin = useStore((s) => s.bin);
  const setBin = useStore((s) => s.setBin);
  return (
    <div className="section">
      <h2>Bin</h2>
      <div className="field">
        <label>Size (x, y, z)</label>
        <div className="row3">
          <input
            type="number"
            min={1}
            max={20}
            value={bin.gridx}
            onChange={(e) => setBin({ gridx: Math.max(1, parseInt(e.target.value) || 1) })}
          />
          <input
            type="number"
            min={1}
            max={20}
            value={bin.gridy}
            onChange={(e) => setBin({ gridy: Math.max(1, parseInt(e.target.value) || 1) })}
          />
          <input
            type="number"
            min={1}
            max={20}
            value={bin.gridz}
            onChange={(e) => setBin({ gridz: Math.max(1, parseFloat(e.target.value) || 1) })}
          />
        </div>
      </div>
      <div className="field">
        <label>Height mode</label>
        <select
          value={bin.gridzMode}
          onChange={(e) => setBin({ gridzMode: e.target.value as GridzMode })}
        >
          <option value="increments">7mm increments</option>
          <option value="internal">Internal mm</option>
          <option value="external">External mm (no lip)</option>
          <option value="external-with-lip">External mm (with lip)</option>
        </select>
      </div>
      <div className="field">
        <label>Stacking lip</label>
        <input
          type="checkbox"
          checked={bin.includeLip}
          onChange={(e) => setBin({ includeLip: e.target.checked })}
        />
      </div>
      <div className="field">
        <label>Magnet holes</label>
        <input
          type="checkbox"
          checked={bin.magnetHoles}
          onChange={(e) => setBin({ magnetHoles: e.target.checked })}
        />
      </div>
      <div className="field">
        <label>Screw holes</label>
        <input
          type="checkbox"
          checked={bin.screwHoles}
          onChange={(e) => setBin({ screwHoles: e.target.checked })}
        />
      </div>
      <div className="field">
        <label>Corner holes only</label>
        <input
          type="checkbox"
          checked={bin.onlyCorners}
          onChange={(e) => setBin({ onlyCorners: e.target.checked })}
        />
      </div>
      <div className="muted" style={{ marginTop: 6 }}>
        Outer: {(bin.gridx * 42).toFixed(0)} x {(bin.gridy * 42).toFixed(0)} mm
      </div>
    </div>
  );
}

function ObjectsPanel() {
  const objects = useStore((s) => s.objects);
  const selectedId = useStore((s) => s.selectedId);
  const selectObject = useStore((s) => s.selectObject);
  const updateObject = useStore((s) => s.updateObject);
  const removeObject = useStore((s) => s.removeObject);
  const uploads = useStore((s) => s.uploads);
  const addText = useStore((s) => s.addText);

  return (
    <div className="section">
      <h2>Objects ({objects.length})</h2>
      {objects.length === 0 && <div className="muted">Upload an STL or add a text label.</div>}
      {objects.map((o) => {
        const isSelected = o.id === selectedId;
        const name = o.kind === "stl" ? uploads.get((o as PlacedStl).filename)?.originalName ?? o.filename : `"${(o as PlacedText).text}"`;
        return (
          <div
            key={o.id}
            className={`object-row${isSelected ? " selected" : ""}`}
            onClick={() => selectObject(o.id)}
          >
            <div className="head">
              <span style={{ width: 8, height: 8, borderRadius: 4, background: o.kind === "stl" ? "#ff8855" : "#9966ff" }} />
              <span className="name">{name}</span>
              <button
                className="danger"
                onClick={(e) => {
                  e.stopPropagation();
                  removeObject(o.id);
                }}
              >
                X
              </button>
            </div>
            {isSelected && (
              <div className="body">
                <div className="field">
                  <label>Position</label>
                  <div className="row3">
                    {([0, 1, 2] as const).map((i) => (
                      <input
                        key={i}
                        type="number"
                        step="0.5"
                        value={o.position[i].toFixed(2)}
                        onChange={(e) => {
                          const v = parseFloat(e.target.value);
                          if (!Number.isFinite(v)) return;
                          const p: [number, number, number] = [o.position[0], o.position[1], o.position[2]];
                          p[i] = v;
                          updateObject(o.id, { position: p });
                        }}
                      />
                    ))}
                  </div>
                </div>
                <NumField
                  label="Rotation Z (deg)"
                  value={o.rotationZ}
                  step={5}
                  onChange={(v) => updateObject(o.id, { rotationZ: v })}
                />
                {o.kind === "stl" && (
                  <NumField
                    label="Oversize %"
                    value={(o as PlacedStl).oversizePct}
                    step={0.5}
                    onChange={(v) => updateObject(o.id, { oversizePct: v })}
                  />
                )}
                {o.kind === "text" && (
                  <>
                    <div className="field">
                      <label>Text</label>
                      <input
                        type="text"
                        value={(o as PlacedText).text}
                        onChange={(e) => updateObject(o.id, { text: e.target.value })}
                      />
                    </div>
                    <NumField
                      label="Size (mm)"
                      value={(o as PlacedText).size}
                      step={0.5}
                      onChange={(v) => updateObject(o.id, { size: v })}
                    />
                    <NumField
                      label="Depth (mm)"
                      value={(o as PlacedText).depth}
                      step={0.1}
                      onChange={(v) => updateObject(o.id, { depth: v })}
                    />
                    <div className="field">
                      <label>Mode</label>
                      <select
                        value={(o as PlacedText).mode}
                        onChange={(e) => updateObject(o.id, { mode: e.target.value as "deboss" | "emboss" })}
                      >
                        <option value="deboss">Deboss (cut into)</option>
                        <option value="emboss">Emboss (raised on top)</option>
                      </select>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        );
      })}
      <button onClick={() => addText()} style={{ marginTop: 6 }}>+ Add text</button>
    </div>
  );
}

function UploadPanel() {
  const uploadFiles = useStore((s) => s.uploadFiles);
  const [drag, setDrag] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="section">
      <h2>Upload STL</h2>
      <div
        className={`upload-zone${drag ? " drag" : ""}`}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          if (e.dataTransfer.files.length) uploadFiles(e.dataTransfer.files);
        }}
      >
        Click or drop .stl files
      </div>
      <input
        ref={inputRef}
        type="file"
        accept=".stl"
        multiple
        style={{ display: "none" }}
        onChange={(e) => {
          if (e.target.files) uploadFiles(e.target.files);
          e.target.value = "";
        }}
      />
    </div>
  );
}

export function Sidebar() {
  const status = useStore((s) => s.status);
  const renderBin = useStore((s) => s.renderBin);
  const gizmoMode = useStore((s) => s.gizmoMode);
  const setGizmoMode = useStore((s) => s.setGizmoMode);
  const objects = useStore((s) => s.objects);
  const canRender = objects.length > 0 && status !== "rendering" && status !== "uploading";

  return (
    <aside className="sidebar">
      <header>
        <h1>Gridfinity Cavity Builder</h1>
        <span className={`status ${status}`}>{status}</span>
      </header>
      <div className="scroll">
        <BinConfigPanel />
        <UploadPanel />
        <ObjectsPanel />
      </div>
      <div style={{ padding: 12, borderTop: "1px solid var(--border)", display: "flex", gap: 6, flexDirection: "column" }}>
        <div style={{ display: "flex", gap: 4 }}>
          <button
            style={{ flex: 1, background: gizmoMode === "translate" ? "var(--accent)" : undefined, color: gizmoMode === "translate" ? "#08111f" : undefined }}
            onClick={() => setGizmoMode("translate")}
          >
            Move
          </button>
          <button
            style={{ flex: 1, background: gizmoMode === "rotate" ? "var(--accent)" : undefined, color: gizmoMode === "rotate" ? "#08111f" : undefined }}
            onClick={() => setGizmoMode("rotate")}
          >
            Rotate
          </button>
        </div>
        <button className="primary" disabled={!canRender} onClick={() => renderBin()}>
          {status === "rendering" ? "Rendering..." : "Render & Download STL"}
        </button>
      </div>
    </aside>
  );
}
