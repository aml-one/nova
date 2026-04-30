import { cn } from "../../lib/cn";
import { Button } from "./button";

export function Tabs({
  tabs,
  active,
  onChange
}: {
  tabs: Array<{ id: string; label: string; tone?: "blue" | "orange" | "pink" | "green" | "red" | "yellow" | "purple" | "neutral" }>;
  active: string;
  onChange: (id: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {tabs.map((tab) => (
        <Button
          key={tab.id}
          type="button"
          tone={active === tab.id ? tab.tone ?? "blue" : "neutral"}
          className={cn(active === tab.id ? "" : "opacity-80")}
          onClick={() => onChange(tab.id)}
        >
          {tab.label}
        </Button>
      ))}
    </div>
  );
}
