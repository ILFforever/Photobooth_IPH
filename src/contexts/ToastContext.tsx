import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';
import { Info, AlertTriangle, AlertCircle, CheckCircle } from 'lucide-react';

export type ToastType = 'info' | 'warning' | 'error' | 'success';

export interface Toast {
  id: string;
  type: ToastType;
  title: string;
  description?: string;
  duration?: number; // Auto-dismiss after ms (0 = no auto-dismiss)
}

// Icon mapping for toast types
const toastIcons: Record<ToastType, React.ReactNode> = {
  info: <Info size={16} />,
  warning: <AlertTriangle size={16} />,
  error: <AlertCircle size={16} />,
  success: <CheckCircle size={16} />,
};

interface ToastContextType {
  toasts: Toast[];
  showToast: (title: string, type?: ToastType, duration?: number, description?: string) => void;
  removeToast: (id: string) => void;
}

const ToastContext = createContext<ToastContextType | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const showToast = useCallback((title: string, type: ToastType = 'info', duration: number = 4000, description?: string) => {
    const id = Math.random().toString(36).substring(7);
    const newToast: Toast = { id, type, title, description, duration };

    setToasts(prev => [...prev, newToast]);

    // Auto-dismiss after duration (if duration > 0)
    if (duration > 0) {
      setTimeout(() => {
        setToasts(prev => prev.filter(t => t.id !== id));
      }, duration);
    }
  }, []);

  const removeToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ toasts, showToast, removeToast }}>
      {children}
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
}

// Toast Container Component
export function ToastContainer() {
  const { toasts, removeToast } = useToast();

  return (
    <div className="toast-container">
      {toasts.map(toast => (
        <div key={toast.id} className={`toast toast-${toast.type}`}>
          {toastIcons[toast.type]}
          <div className="toast-content">
            <span className="toast-title">{toast.title}</span>
            {toast.description && <span className="toast-description">{toast.description}</span>}
          </div>
        </div>
      ))}
    </div>
  );
}
