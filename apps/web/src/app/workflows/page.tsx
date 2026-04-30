"use client";

import { FormEvent, useEffect, useState } from "react";
import { Card } from "../../components/ui/card";
import { Input } from "../../components/ui/input";
import { Textarea } from "../../components/ui/textarea";
import { Button } from "../../components/ui/button";
import { Select } from "../../components/ui/select";

type Workflow = {
  id: string;
  name: string;
  triggerType: string;
  actionType: string;
  enabled: boolean;
  createdAt: string;
};

export default function WorkflowsPage() {
  const [items, setItems] = useState<Workflow[]>([]);
  const [name, setName] = useState("");
  const [triggerType, setTriggerType] = useState("cron");
  const [triggerConfig, setTriggerConfig] = useState('{"cron":"0 8 * * *"}');
  const [actionType, setActionType] = useState("chat");
  const [actionConfig, setActionConfig] = useState('{"message":"Good morning summary"}');

  async function load(): Promise<void> {
    const response = await fetch("/api/workflows");
    const data = (await response.json()) as { items?: Workflow[] };
    if (response.ok) setItems(data.items ?? []);
  }

  useEffect(() => {
    void load();
  }, []);

  async function createWorkflow(event: FormEvent): Promise<void> {
    event.preventDefault();
    await fetch("/api/workflows", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name,
        triggerType,
        triggerConfig: JSON.parse(triggerConfig),
        actionType,
        actionConfig: JSON.parse(actionConfig)
      })
    });
    setName("");
    await load();
  }

  return (
    <div className="space-y-4">
      <Card>
        <h1 className="text-2xl font-semibold">Workflow Builder</h1>
        <p className="text-sm text-muted">Define if-this-then-that rules for Nova tasks.</p>
      </Card>
      <Card>
        <form onSubmit={createWorkflow} className="space-y-2">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Workflow name" />
          <div className="grid gap-2 md:grid-cols-2">
            <Select value={triggerType} onChange={(e) => setTriggerType(e.target.value)}>
              <option value="cron">Trigger: Cron</option>
              <option value="security_event">Trigger: Security Event</option>
              <option value="idle">Trigger: Idle</option>
            </Select>
            <Select value={actionType} onChange={(e) => setActionType(e.target.value)}>
              <option value="chat">Action: Chat</option>
              <option value="run_command">Action: Run Command</option>
              <option value="notify">Action: Notify</option>
            </Select>
          </div>
          <Textarea rows={3} value={triggerConfig} onChange={(e) => setTriggerConfig(e.target.value)} placeholder="Trigger JSON" />
          <Textarea rows={3} value={actionConfig} onChange={(e) => setActionConfig(e.target.value)} placeholder="Action JSON" />
          <Button type="submit" tone="green">Create Workflow</Button>
        </form>
      </Card>
      <Card className="space-y-2">
        {items.map((item) => (
          <article key={item.id} className="rounded-ui border bg-surface p-3 text-sm">
            <strong>{item.name}</strong> · {item.triggerType} → {item.actionType}
          </article>
        ))}
      </Card>
    </div>
  );
}
