import { Plus } from "lucide-react";
import { useState } from "react";
import { SectionHeader } from "@/components/SectionHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";

const VARIANTS = ["default", "secondary", "outline", "ghost", "destructive", "link"] as const;

const SIZES = ["xs", "sm", "default", "lg", "icon"] as const;

export function ControlsSection() {
  const [protocol, setProtocol] = useState("ssh");
  const [airplaneMode, setAirplaneMode] = useState(true);
  const [agree, setAgree] = useState(true);

  return (
    <section className="space-y-6">
      <SectionHeader title="Controls" />

      <div className="space-y-4">
        <h2 className="text-sm font-medium">Buttons — variants</h2>
        <div className="flex flex-wrap items-center gap-3">
          {VARIANTS.map((variant) => (
            <Button key={variant} variant={variant}>
              {variant}
            </Button>
          ))}
          <Button variant="default" size="icon" aria-label="New connection">
            <Plus />
          </Button>
        </div>
      </div>

      <div className="space-y-4">
        <h2 className="text-sm font-medium">Buttons — sizes</h2>
        <div className="flex flex-wrap items-center gap-3">
          {SIZES.map((size) => (
            <Button key={size} size={size}>
              {size}
            </Button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-6 rounded-xl border border-border bg-card p-4">
        <Input placeholder="Search connections..." />
        <div className="flex items-center gap-2">
          <Switch
            checked={airplaneMode}
            onCheckedChange={(checked) => setAirplaneMode(checked === true)}
            aria-label="Airplane mode"
          />
          <span className="text-sm">Airplane mode</span>
        </div>
        <div className="flex items-center gap-2">
          <Checkbox
            checked={agree}
            onCheckedChange={(checked) => setAgree(checked === true)}
            id="agree"
          />
          <label htmlFor="agree" className="text-sm">
            Agree
          </label>
        </div>
        <Select value={protocol} onValueChange={setProtocol}>
          <SelectTrigger className="w-[180px]" aria-label="Select protocol">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value="ssh">SSH</SelectItem>
              <SelectItem value="rdp">RDP</SelectItem>
              <SelectItem value="sftp">SFTP</SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>
        <Badge variant="secondary">badge</Badge>
      </div>
    </section>
  );
}
