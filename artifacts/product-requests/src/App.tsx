import { Switch, Route, Router as WouterRouter, Redirect } from "wouter";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "./lib/queryClient";
import { AuthProvider, useAuth } from "./lib/auth";
import { ThemeProvider } from "./lib/theme";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Loader2 } from "lucide-react";
import NotFound from "@/pages/not-found";

import HomePage from "./pages/home";
import AppShell from "./pages/app/shell";
import ChatPage from "./pages/app/chat";
import RequestsPage from "./pages/requests";
import RequestDetailPage from "./pages/requests/detail";
import TasksPage from "./pages/tasks";
import AdminPage from "./pages/admin";
import SignInPage from "./pages/auth/sign-in";
import SignUpPage from "./pages/auth/sign-up";
import VerifyEmailPage from "./pages/auth/verify-email";
import ForgotPasswordPage from "./pages/auth/forgot-password";
import ResetPasswordPage from "./pages/auth/reset-password";

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

function FullScreenSpinner() {
  return (
    <div className="min-h-[100dvh] flex items-center justify-center bg-background">
      <Loader2 className="w-8 h-8 text-primary animate-spin" />
    </div>
  );
}

function HomeRedirect() {
  const { me, isLoading } = useAuth();
  if (isLoading) return <FullScreenSpinner />;
  if (me) return <Redirect to="/app" />;
  return <HomePage />;
}

function ProtectedRoute({
  component: Component,
  ...rest
}: {
  component: React.ComponentType;
  [key: string]: unknown;
}) {
  return (
    <Route {...rest}>
      {() => {
        const { me, isLoading } = useAuth();
        if (isLoading) return <FullScreenSpinner />;
        if (!me) return <Redirect to="/sign-in" />;
        return (
          <AppShell>
            <Component />
          </AppShell>
        );
      }}
    </Route>
  );
}

function AppRoutes() {
  return (
    <TooltipProvider>
      <Switch>
        <Route path="/" component={HomeRedirect} />
        <Route path="/sign-in" component={SignInPage} />
        <Route path="/sign-up" component={SignUpPage} />
        <Route path="/auth/verify-email" component={VerifyEmailPage} />
        <Route path="/forgot-password" component={ForgotPasswordPage} />
        <Route path="/auth/reset-password" component={ResetPasswordPage} />

        <ProtectedRoute path="/app" component={ChatPage} />
        <ProtectedRoute path="/app/conversations/:id" component={ChatPage} />
        <ProtectedRoute path="/requests" component={RequestsPage} />
        <ProtectedRoute path="/requests/:id" component={RequestDetailPage} />
        <ProtectedRoute path="/tasks" component={TasksPage} />
        <ProtectedRoute path="/admin" component={AdminPage} />

        <Route component={NotFound} />
      </Switch>
      <Toaster />
    </TooltipProvider>
  );
}

export default function App() {
  return (
    <WouterRouter base={basePath}>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <AuthProvider>
            <AppRoutes />
          </AuthProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </WouterRouter>
  );
}
