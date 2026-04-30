"use client";

import { useState } from "react";
import { Card } from "../../components/ui/card";
import { Input } from "../../components/ui/input";
import { Button } from "../../components/ui/button";

export default function OcrPage() {
  const [filePath, setFilePath] = useState("");
  const [result, setResult] = useState<unknown>(null);

  return (
    <div className="space-y-4">
      <Card>
        <h1 className="text-2xl font-semibold">OCR + Table Extraction</h1>
        <p className="text-sm text-muted">Extract text/tables from images or PDFs (command-backed).</p>
        <p className="mt-1 text-xs text-muted">
          Preferred adapter output: JSON object with <code>text</code> and <code>tables</code> fields. Set{" "}
          <code>NOVA_OCR_OUTPUT_MODE=json</code> for strict contract mode.
        </p>
      </Card>
      <Card className="space-y-2">
        <Input value={filePath} onChange={(e) => setFilePath(e.target.value)} placeholder="Absolute file path" />
        <Button
          type="button"
          tone="green"
          onClick={async () => {
            const response = await fetch("/api/ocr/extract", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ filePath })
            });
            setResult(await response.json());
          }}
        >
          Extract
        </Button>
      </Card>
      <Card><pre className="overflow-x-auto text-xs">{JSON.stringify(result, null, 2)}</pre></Card>
    </div>
  );
}
