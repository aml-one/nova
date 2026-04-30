"use client";

import { useEffect, useState } from "react";
import { Card } from "../../components/ui/card";
import { Button } from "../../components/ui/button";

type CameraItem = {
  camera_id: string;
  label: string;
  color?: string;
  plate?: string;
  capture_path?: string;
  created_at: string;
};

export default function CamerasPage() {
  const [items, setItems] = useState<CameraItem[]>([]);

  async function load(): Promise<void> {
    const response = await fetch("/api/camera/timeline");
    const data = (await response.json()) as { items?: CameraItem[] };
    if (response.ok) setItems(data.items ?? []);
  }

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 5000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="space-y-4">
      <Card className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Camera Mosaic</h1>
          <p className="text-sm text-muted">Live semantic alerts from camera timeline detections.</p>
        </div>
        <Button type="button" tone="blue" onClick={() => void load()}>Refresh</Button>
      </Card>
      <div className="grid gap-3 md:grid-cols-3">
        {items.slice(0, 30).map((item, index) => (
          <Card key={`${item.camera_id}-${item.created_at}-${index}`} className="space-y-2">
            <div className="text-xs text-muted">{item.camera_id}</div>
            <strong>{item.label}</strong>
            <div className="text-sm">color: {item.color ?? "-"}</div>
            <div className="text-sm">plate: {item.plate ?? "-"}</div>
            <div className="text-xs text-muted">{new Date(item.created_at).toLocaleString()}</div>
          </Card>
        ))}
      </div>
    </div>
  );
}
