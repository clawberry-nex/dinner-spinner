"use client";

import { createContext, useContext, type ReactNode } from "react";
import { type ExperienceConfig, liveExperienceConfig, demoExperienceConfig } from "./config";

// Default is the LIVE config, so existing pages need no provider.
const ExperienceContext = createContext<ExperienceConfig>(liveExperienceConfig);

export function useExperienceConfig(): ExperienceConfig {
  return useContext(ExperienceContext);
}

export function ExperienceProvider({ value, children }: { value: ExperienceConfig; children: ReactNode }) {
  return <ExperienceContext.Provider value={value}>{children}</ExperienceContext.Provider>;
}

// Binds the demo config internally so a SERVER layout can mount it without
// passing functions across the RSC boundary.
export function DemoExperienceProvider({ children }: { children: ReactNode }) {
  return <ExperienceContext.Provider value={demoExperienceConfig}>{children}</ExperienceContext.Provider>;
}
