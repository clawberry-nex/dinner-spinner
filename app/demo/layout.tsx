// Server layout for the /demo subtree. Wraps everything in the demo
// ExperienceConfig so the shared experiences read snapshot data, write to the
// isolated demoMealPlan key, and never persist to the server.
import { DemoExperienceProvider } from "../_experiences/experience-config";

export default function DemoLayout({ children }: { children: React.ReactNode }) {
  return <DemoExperienceProvider>{children}</DemoExperienceProvider>;
}
