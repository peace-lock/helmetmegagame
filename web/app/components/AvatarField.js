"use client";

import { useState } from "react";

export default function AvatarField({ defaultTurnPingOptIn, defaultRomanceOptOut }) {
  const [fileName, setFileName] = useState("");

  return (
    <div className="field">
      <span className="field-label">Profile picture</span>
      <div className="flex flex-wrap items-center gap-3">
        <label className="btn" style={{ cursor: "pointer" }}>
          Browse
          <input
            type="file"
            name="avatar"
            accept="image/*"
            style={{ display: "none" }}
            onChange={(e) => setFileName(e.target.files?.[0]?.name ?? "")}
          />
        </label>
        <label className="flex items-center gap-2 text-sm" style={{ cursor: "pointer" }}>
          <input type="checkbox" name="turnPingOptIn" defaultChecked={defaultTurnPingOptIn} />
          <span className="field-label" style={{ marginBottom: 0 }}>
            Turn Ping?
          </span>
        </label>
        <label className="flex items-center gap-2 text-sm" style={{ cursor: "pointer" }}>
          <input type="checkbox" name="romanceOptOut" defaultChecked={defaultRomanceOptOut} />
          <span className="field-label" style={{ marginBottom: 0 }}>
            Disable Romance Content?
          </span>
        </label>
        {fileName ? (
          <span className="text-sm text-muted">
            {fileName}
          </span>
        ) : null}
      </div>
    </div>
  );
}
