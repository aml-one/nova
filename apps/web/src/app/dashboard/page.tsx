"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type HistoryRow = {
  run_id: string;
  user_id: string;
  channel: string;
  input_text: string;
  output_text?: string;
  created_at: string;
};

type UserRow = {
  user_id: string;
  preferred_name?: string;
  preferred_style?: string;
  preferred_persona_id?: string;
  memory_count: number;
};

export default function DashboardPage() {
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      setLoading(true);
      const [historyRes, usersRes] = await Promise.all([fetch("/api/dashboard/history"), fetch("/api/dashboard/users")]);
      const historyData = (await historyRes.json()) as { items: HistoryRow[] };
      const usersData = (await usersRes.json()) as { items: UserRow[] };
      setHistory(historyData.items ?? []);
      setUsers(usersData.items ?? []);
      setLoading(false);
    })();
  }, []);

  return (
    <main style={{ fontFamily: "sans-serif", margin: "2rem auto", maxWidth: 980 }}>
      <h1>Nova Dashboard</h1>
      <p>
        <Link href="/settings">Settings</Link> · <Link href="/learning">Learning</Link> · <Link href="/emotion">Emotion</Link> · <Link href="/security">Security</Link>
      </p>
      {loading ? <p>Loading...</p> : null}
      <section style={{ marginTop: 16 }}>
        <h2>Users</h2>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th align="left">User</th>
              <th align="left">Name</th>
              <th align="left">Style</th>
              <th align="left">Persona</th>
              <th align="left">Memory</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.user_id}>
                <td>{user.user_id}</td>
                <td>{user.preferred_name ?? "-"}</td>
                <td>{user.preferred_style ?? "-"}</td>
                <td>{user.preferred_persona_id ?? "-"}</td>
                <td>{user.memory_count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <section style={{ marginTop: 20 }}>
        <h2>Recent Runs</h2>
        {history.slice(0, 20).map((row) => (
          <article key={row.run_id} style={{ padding: 10, border: "1px solid #ddd", marginBottom: 8 }}>
            <div>
              <strong>{row.channel}</strong> · {row.user_id}
            </div>
            <div>Input: {row.input_text}</div>
            <div>Output: {row.output_text ?? "-"}</div>
          </article>
        ))}
      </section>
    </main>
  );
}
