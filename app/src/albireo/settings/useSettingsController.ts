import { useCallback, useEffect, useState } from 'react';
import { api } from '../../lib/api';
import type { PersonaProfile } from '../../types';

export interface TabConfig {
  model: string;
  base_url: string;
  api_key_masked?: string;
  api_key?: string;
  _api_key_input?: string;
  max_tokens?: number;
  temperature?: number;
}

export interface ApiConfig {
  dehydration?: TabConfig;
  awakening?: TabConfig;
  dreaming?: TabConfig;
  chat?: TabConfig;
  embedding?: { enabled: boolean; model: string };
  merge_threshold?: number;
  chat_history_limit?: number;
  transport?: string;
  buckets_dir?: string;
}

export interface SystemStatus {
  decay_engine: 'running' | 'stopped';
  embedding_enabled: boolean;
  buckets: {
    permanent: number;
    dynamic: number;
    archive: number;
    total: number;
  };
  using_env_password: boolean;
  version: string;
}

export interface HostVault {
  value: string;
  source: 'env' | 'file' | '';
  env_file?: string;
}

export type PushStatus = 'unsupported' | 'denied' | 'not-subscribed' | 'subscribed';

function urlBase64ToUint8Array(base64String: string) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  return Uint8Array.from(rawData, (character) => character.charCodeAt(0));
}

export function useSettingsController() {
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [profiles, setProfiles] = useState<PersonaProfile[]>([]);
  const [config, setConfig] = useState<ApiConfig | null>(null);
  const [status, setStatus] = useState<SystemStatus | null>(null);
  const [hostVault, setHostVault] = useState<HostVault | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [usageStats, setUsageStats] = useState<any>(null);
  const [savingsStats, setSavingsStats] = useState<any>(null);
  const [awakeningLog, setAwakeningLog] = useState<any[]>([]);
  const [pushStatus, setPushStatus] = useState<PushStatus>('not-subscribed');

  const openMeridian = useCallback(() => setIsOpen(true), []);
  const closeMeridian = useCallback(() => setIsOpen(false), []);

  const loadData = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [profilesData, configData, statusData, vaultData, usageData, savingsData, logData] = await Promise.all([
        api.getPersonaProfiles(),
        api.getConfig(),
        api.getStatus(),
        api.getHostVault(),
        api.getStatsUsage(7),
        api.getStatsSavings(30),
        api.getAwakeningLog(10)
      ]);
      setProfiles(profilesData);
      setConfig(configData as ApiConfig);
      setStatus(statusData as SystemStatus);
      setHostVault(vaultData as HostVault);
      setUsageStats(usageData);
      setSavingsStats(savingsData);
      setAwakeningLog(logData);
    } catch (err: any) {
      console.error('Failed to load settings data', err);
      setError(err?.message || 'Failed to load settings');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      loadData();
    }
  }, [isOpen, loadData]);

  useEffect(() => {
    const checkPushSubscription = async () => {
      if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
        setPushStatus('unsupported');
        return;
      }
      if (Notification.permission === 'denied') {
        setPushStatus('denied');
        return;
      }
      try {
        const registration = await navigator.serviceWorker.ready;
        const subscription = await registration.pushManager.getSubscription();
        setPushStatus(subscription ? 'subscribed' : 'not-subscribed');
      } catch (err) {
        console.error('Failed to inspect push subscription', err);
        setPushStatus('not-subscribed');
      }
    };

    void checkPushSubscription();
  }, []);

  const saveProfile = useCallback(async (profile: Partial<PersonaProfile>) => {
    try {
      const isNew = !profile.id;
      const saved = isNew
        ? await api.createPersonaProfile(profile)
        : await api.updatePersonaProfile(profile.id!, profile);
      
      setProfiles((current) => {
        if (isNew && saved) return [...current, saved];
        return current.map((p) => (p.id === saved.id ? saved : p));
      });
      return saved;
    } catch (err: any) {
      throw new Error(err?.message || 'Failed to save profile');
    }
  }, []);

  const deleteProfile = useCallback(async (id: string) => {
    try {
      await api.deletePersonaProfile(id);
      setProfiles((current) => current.filter((p) => p.id !== id));
    } catch (err: any) {
      throw new Error(err?.message || 'Failed to delete profile');
    }
  }, []);

  const saveConfig = useCallback(async (newConfig: Partial<ApiConfig>) => {
    try {
      await api.updateConfig({ persist: true, ...newConfig });
      const updated = await api.getConfig();
      setConfig(updated as ApiConfig);
    } catch (err: any) {
      throw new Error(err?.message || 'Failed to save config');
    }
  }, []);

  const testConnection = useCallback(async (tab: string, model: string, baseUrl: string, apiKey: string) => {
    return await api.testConfigApi({ model, base_url: baseUrl, api_key: apiKey, tab });
  }, []);

  const updateHostVault = useCallback(async (path: string) => {
    try {
      const result = await api.updateHostVault(path);
      setHostVault((current) => current ? { ...current, value: result.value } : null);
      return result;
    } catch (err: any) {
      throw new Error(err?.message || 'Failed to update vault path');
    }
  }, []);

  const triggerAwakening = useCallback(async () => {
    return await api.triggerAwakening();
  }, []);

  const testPushNotification = useCallback(async () => {
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
      setPushStatus('unsupported');
      throw new Error('Push notifications are not supported in this browser');
    }

    const registration = await navigator.serviceWorker.ready;
    let subscription = await registration.pushManager.getSubscription();

    if (!subscription) {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        setPushStatus('denied');
        throw new Error('Notification permission was not granted');
      }

      const { public_key: publicKey } = await api.getPushPublicKey();
      if (!publicKey) {
        throw new Error('VAPID public key is unavailable');
      }

      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });
    }

    const subscribeResult = await api.subscribePush(subscription);
    if (!subscribeResult.ok && subscribeResult.status !== 'subscribed') {
      throw new Error(subscribeResult.error || 'Failed to register push subscription');
    }

    setPushStatus('subscribed');
    return await api.testPush();
  }, []);

  return {
    isOpen,
    isLoading,
    error,
    profiles,
    config,
    status,
    hostVault,
    usageStats,
    savingsStats,
    awakeningLog,
    pushStatus,
    openMeridian,
    closeMeridian,
    saveProfile,
    deleteProfile,
    saveConfig,
    testConnection,
    updateHostVault,
    triggerAwakening,
    testPushNotification,
    reload: loadData,
  };
}
