import {
  createRootRoute,
  createRoute,
  Outlet,
  redirect,
} from "@tanstack/react-router";
import { AppLayout } from "@/components/shared/AppLayout";
import { OnboardingPage } from "@/pages/OnboardingPage";
import { AssistantPage } from "@/pages/AssistantPage";
import { ProjectsPage } from "@/pages/ProjectsPage";
import { ProjectPage } from "@/pages/ProjectPage";
import { TabularReviewsPage } from "@/pages/TabularReviewsPage";
import { TabularReviewPage } from "@/pages/TabularReviewPage";
import { WorkflowsPage } from "@/pages/WorkflowsPage";
import { WorkflowEditorPage } from "@/pages/WorkflowEditorPage";
import { ChatsPage } from "@/pages/ChatsPage";
import { SettingsPage } from "@/pages/SettingsPage";
import { api } from "@/lib/tauri";

const rootRoute = createRootRoute({ component: Outlet });

const onboardingRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/onboarding",
  component: OnboardingPage,
  beforeLoad: async () => {
    // In dev, reset onboarding so we always see it
    if (import.meta.env.DEV) {
      try {
        await api.updateSettings({ onboardingComplete: false });
      } catch { /* ignore if backend not ready */ }
    }
  },
});

const layoutRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: "app",
  component: AppLayout,
  beforeLoad: async () => {
    try {
      const settings = await api.getSettings();
      if (!settings.onboardingComplete) {
        throw redirect({ to: "/onboarding" });
      }
    } catch (e) {
      // Re-throw redirects (from above or TanStack internals)
      if (e && typeof e === "object" && "to" in e) throw e;
      // Real error: backend not ready, redirect to onboarding
      throw redirect({ to: "/onboarding" });
    }
  },
});

const indexRoute = createRoute({
  getParentRoute: () => layoutRoute,
  path: "/",
  component: AssistantPage,
});

const chatRoute = createRoute({
  getParentRoute: () => layoutRoute,
  path: "/chat/$id",
  component: AssistantPage,
});

const chatsRoute = createRoute({
  getParentRoute: () => layoutRoute,
  path: "/chats",
  component: ChatsPage,
});

const projectsRoute = createRoute({
  getParentRoute: () => layoutRoute,
  path: "/projects",
  component: ProjectsPage,
});

const projectRoute = createRoute({
  getParentRoute: () => layoutRoute,
  path: "/projects/$id",
  component: ProjectPage,
});

const reviewsRoute = createRoute({
  getParentRoute: () => layoutRoute,
  path: "/tabular-reviews",
  component: TabularReviewsPage,
});

const reviewRoute = createRoute({
  getParentRoute: () => layoutRoute,
  path: "/tabular-reviews/$id",
  component: TabularReviewPage,
});

const workflowsRoute = createRoute({
  getParentRoute: () => layoutRoute,
  path: "/workflows",
  component: WorkflowsPage,
});

const workflowEditorRoute = createRoute({
  getParentRoute: () => layoutRoute,
  path: "/workflows/$id",
  component: WorkflowEditorPage,
});

const settingsRoute = createRoute({
  getParentRoute: () => layoutRoute,
  path: "/settings",
  component: SettingsPage,
});

export const routeTree = rootRoute.addChildren([
  onboardingRoute,
  layoutRoute.addChildren([
    indexRoute,
    chatRoute,
    chatsRoute,
    projectsRoute,
    projectRoute,
    reviewsRoute,
    reviewRoute,
    workflowsRoute,
    workflowEditorRoute,
    settingsRoute,
  ]),
]);
