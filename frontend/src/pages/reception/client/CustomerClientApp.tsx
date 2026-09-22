import { useState } from "react";
import { CustomerInfoCollectionPage, type CustomerProfile } from "./CustomerInfoCollectionPage";
import { CustomerChatWorkbenchPage } from "./CustomerChatWorkbenchPage";
import { type MessageItem, type SessionItem } from "../receptionApi";

export const STORAGE_PROFILE_KEY = "ticket_hub_customer_profile";
export const STORAGE_SESSION_KEY = "ticket_hub_customer_session";

export function CustomerClientApp() {
  const [profile, setProfile] = useState<CustomerProfile | null>(() => {
    try {
      const saved = sessionStorage.getItem(STORAGE_PROFILE_KEY);
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });

  const [initialSession, setInitialSession] = useState<SessionItem | null>(() => {
    try {
      const saved = sessionStorage.getItem(STORAGE_SESSION_KEY);
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });

  const [initialMessages, setInitialMessages] = useState<MessageItem[]>([]);

  const handleCollectionSuccess = (data: {
    profile: CustomerProfile;
    session?: SessionItem | null;
    messages?: MessageItem[];
  }) => {
    setProfile(data.profile);
    setInitialSession(data.session || null);
    setInitialMessages(data.messages || []);
    try {
      sessionStorage.setItem(STORAGE_PROFILE_KEY, JSON.stringify(data.profile));
      if (data.session) {
        sessionStorage.setItem(STORAGE_SESSION_KEY, JSON.stringify(data.session));
      } else {
        sessionStorage.removeItem(STORAGE_SESSION_KEY);
      }
    } catch (e) {
      console.warn("Failed to save customer session to sessionStorage", e);
    }
  };

  const handleBackToLogin = () => {
    setProfile(null);
    setInitialSession(null);
    setInitialMessages([]);
    try {
      sessionStorage.removeItem(STORAGE_PROFILE_KEY);
      sessionStorage.removeItem(STORAGE_SESSION_KEY);
    } catch (e) {
      console.warn("Failed to clear customer session", e);
    }
  };

  if (!profile) {
    return <CustomerInfoCollectionPage onSuccess={handleCollectionSuccess} />;
  }

  return (
    <CustomerChatWorkbenchPage
      profile={profile}
      initialSession={initialSession}
      initialMessages={initialMessages}
      onBackToLogin={handleBackToLogin}
    />
  );
}

export default CustomerClientApp;
