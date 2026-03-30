import React, { useState, useCallback } from 'react';
import {
  Wifi,
  WifiOff,
  Link,
  Unlink,
  Loader2,
  RefreshCw,
  CheckCircle2,
  XCircle,
  Copy,
} from 'lucide-react';
import { IPC_CHANNELS } from '@rmpg/shared';
import { PageHeader, LogConsole } from '../components/common';
import { useIpc } from '../hooks';

type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'pairing' | 'error';

export const WifiDebug: React.FC = () => {
  const ipc = useIpc();

  const [ipAddress, setIpAddress] = useState('');
  const [port, setPort] = useState('5555');
  const [pairCode, setPairCode] = useState('');
  const [pairPort, setPairPort] = useState('');
  const [status, setStatus] = useState<ConnectionStatus>('disconnected');
  const [statusMessage, setStatusMessage] = useState('Not connected');
  const [detectedIp, setDetectedIp] = useState('');
  const [logs, setLogs] = useState<string[]>([]);

  const addLog = useCallback(
    (msg: string) => setLogs((prev) => [...prev, `[${new Date().toLocaleTimeString()}] ${msg}`]),
    []
  );

  const handleDetectIp = async () => {
    addLog('Detecting device WiFi IP address...');
    try {
      const result = await ipc.invoke<{ ip: string }>(IPC_CHANNELS.WIFI_CONNECT, {
        action: 'detect-ip',
      });
      if (result?.ip) {
        setDetectedIp(result.ip);
        setIpAddress(result.ip);
        addLog(`Detected IP: ${result.ip}`);
      } else {
        addLog('Could not detect IP. Ensure device is connected via USB and on the same network.');
      }
    } catch (err) {
      addLog(`Detection failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handlePair = async () => {
    if (!ipAddress || !pairCode || !pairPort) return;
    setStatus('pairing');
    setStatusMessage('Pairing...');
    addLog(`Pairing with ${ipAddress}:${pairPort} using code ${pairCode}`);

    try {
      const result = await ipc.invoke<{ success: boolean; message?: string }>(
        IPC_CHANNELS.WIFI_PAIR,
        {
          ip: ipAddress,
          port: pairPort,
          code: pairCode,
        }
      );

      if (result?.success) {
        setStatus('disconnected');
        setStatusMessage('Paired successfully. Ready to connect.');
        addLog('Pairing successful.');
      } else {
        setStatus('error');
        setStatusMessage(result?.message ?? 'Pairing failed');
        addLog(`Pairing failed: ${result?.message ?? 'Unknown error'}`);
      }
    } catch (err) {
      setStatus('error');
      setStatusMessage('Pairing error');
      addLog(`Pairing error: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleConnect = async () => {
    if (!ipAddress || !port) return;
    setStatus('connecting');
    setStatusMessage('Connecting...');
    addLog(`Connecting to ${ipAddress}:${port}...`);

    try {
      const result = await ipc.invoke<{ success: boolean; message?: string }>(
        IPC_CHANNELS.WIFI_CONNECT,
        {
          action: 'connect',
          ip: ipAddress,
          port,
        }
      );

      if (result?.success) {
        setStatus('connected');
        setStatusMessage(`Connected to ${ipAddress}:${port}`);
        addLog('WiFi ADB connection established.');
      } else {
        setStatus('error');
        setStatusMessage(result?.message ?? 'Connection failed');
        addLog(`Connection failed: ${result?.message ?? 'Unknown error'}`);
      }
    } catch (err) {
      setStatus('error');
      setStatusMessage('Connection error');
      addLog(`Connection error: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleDisconnect = async () => {
    addLog('Disconnecting WiFi ADB...');
    try {
      await ipc.invoke(IPC_CHANNELS.WIFI_DISCONNECT, {
        ip: ipAddress,
        port,
      });
      setStatus('disconnected');
      setStatusMessage('Disconnected');
      addLog('WiFi ADB disconnected.');
    } catch (err) {
      addLog(`Disconnect error: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const copyAddress = () => {
    if (ipAddress) {
      navigator.clipboard.writeText(`${ipAddress}:${port}`);
      addLog(`Copied ${ipAddress}:${port} to clipboard.`);
    }
  };

  const statusColor: Record<ConnectionStatus, string> = {
    disconnected: 'text-[var(--text-muted)]',
    connecting: 'text-yellow-600',
    connected: 'text-green-600',
    pairing: 'text-yellow-600',
    error: 'text-red-600',
  };

  const StatusIcon = () => {
    switch (status) {
      case 'connected':
        return <CheckCircle2 size={18} className="text-green-600" />;
      case 'error':
        return <XCircle size={18} className="text-red-600" />;
      case 'connecting':
      case 'pairing':
        return <Loader2 size={18} className="animate-spin text-yellow-600" />;
      default:
        return <WifiOff size={18} className="text-[var(--text-muted)]" />;
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="WiFi ADB Debugging"
        description="Connect to Android devices wirelessly over WiFi for remote debugging and forensic acquisition"
        icon={<Wifi size={24} />}
      />

      {/* Status indicator */}
      <div className="card">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <StatusIcon />
            <div>
              <p className={`text-sm font-medium ${statusColor[status]}`}>{statusMessage}</p>
              {status === 'connected' && (
                <p className="text-xs text-[var(--text-muted)]">{ipAddress}:{port}</p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {status === 'connected' ? (
              <span className="badge-success">Connected</span>
            ) : status === 'error' ? (
              <span className="badge-danger">Error</span>
            ) : status === 'connecting' || status === 'pairing' ? (
              <span className="badge-warning">In Progress</span>
            ) : (
              <span className="badge">Offline</span>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-6">
        {/* Connection panel */}
        <div className="card space-y-4">
          <h3 className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2">
            <Link size={16} className="text-[#6495ED]" />
            Connection Settings
          </h3>

          <div>
            <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
              Device IP Address
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={ipAddress}
                onChange={(e) => setIpAddress(e.target.value)}
                placeholder="192.168.1.100"
                className="input-field flex-1"
                disabled={status === 'connected' || status === 'connecting'}
              />
              <button
                onClick={handleDetectIp}
                className="btn-ghost flex items-center gap-1.5 text-xs"
                title="Auto-detect IP from USB-connected device"
              >
                <RefreshCw size={14} />
                Detect
              </button>
            </div>
            {detectedIp && (
              <p className="mt-1 text-xs text-green-600">Detected: {detectedIp}</p>
            )}
          </div>

          <div>
            <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
              Port
            </label>
            <input
              type="text"
              value={port}
              onChange={(e) => setPort(e.target.value)}
              placeholder="5555"
              className="input-field"
              disabled={status === 'connected' || status === 'connecting'}
            />
          </div>

          <div className="flex gap-2">
            {status === 'connected' ? (
              <button onClick={handleDisconnect} className="btn-danger flex items-center gap-2 flex-1">
                <Unlink size={14} />
                Disconnect
              </button>
            ) : (
              <button
                onClick={handleConnect}
                disabled={!ipAddress || !port || status === 'connecting'}
                className="btn-primary flex items-center gap-2 flex-1"
              >
                {status === 'connecting' ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Link size={14} />
                )}
                Connect
              </button>
            )}
            <button
              onClick={copyAddress}
              disabled={!ipAddress}
              className="btn-ghost"
              title="Copy address"
            >
              <Copy size={14} />
            </button>
          </div>
        </div>

        {/* Pairing panel */}
        <div className="card space-y-4">
          <h3 className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2">
            <Wifi size={16} className="text-[#6495ED]" />
            WiFi Pairing (Android 11+)
          </h3>

          <div className="rounded-lg bg-[var(--bg-primary)] p-3 text-xs text-[var(--text-secondary)] leading-relaxed">
            <p className="font-medium text-[var(--text-primary)] mb-1">How to pair:</p>
            <ol className="list-decimal ml-4 space-y-0.5">
              <li>On the device, go to Developer Options</li>
              <li>Enable Wireless debugging</li>
              <li>Tap "Pair device with pairing code"</li>
              <li>Enter the IP, port, and 6-digit code shown on the device</li>
            </ol>
          </div>

          <div>
            <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
              Pairing Port
            </label>
            <input
              type="text"
              value={pairPort}
              onChange={(e) => setPairPort(e.target.value)}
              placeholder="37149"
              className="input-field"
              disabled={status === 'pairing'}
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
              Pairing Code
            </label>
            <input
              type="text"
              value={pairCode}
              onChange={(e) => setPairCode(e.target.value)}
              placeholder="123456"
              maxLength={6}
              className="input-field font-mono tracking-widest text-center text-lg"
              disabled={status === 'pairing'}
            />
          </div>

          <button
            onClick={handlePair}
            disabled={!ipAddress || !pairCode || !pairPort || status === 'pairing'}
            className="btn-primary flex items-center gap-2 w-full justify-center"
          >
            {status === 'pairing' ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Wifi size={14} />
            )}
            {status === 'pairing' ? 'Pairing...' : 'Pair Device'}
          </button>
        </div>
      </div>

      <LogConsole logs={logs} onClear={() => setLogs([])} />
    </div>
  );
};
