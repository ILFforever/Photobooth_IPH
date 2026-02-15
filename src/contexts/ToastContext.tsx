import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';
import { Info, AlertTriangle, AlertCircle, CheckCircle } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';

export type ToastType = 'info' | 'warning' | 'error' | 'success';

export interface Toast {
  id: string;
  type: ToastType;
  title: string;
  description?: string;
  duration?: number; // Auto-dismiss after ms (0 = no auto-dismiss)
  exiting?: boolean; // Whether toast is in exit animation
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

  const removeToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const showToast = useCallback((title: string, type: ToastType = 'info', duration: number = 4000, description?: string) => {
    const id = Math.random().toString(36).substring(7);
    const newToast: Toast = { id, type, title, description, duration };

    setToasts(prev => [...prev, newToast]);

    // Auto-dismiss after duration (if duration > 0)
    if (duration > 0) {
      setTimeout(() => {
        // First trigger exit animation
        setToasts(prev => prev.map(t => t.id === id ? { ...t, exiting: true } : t));
        // Then remove after exit animation completes (300ms matches the exit duration)
        setTimeout(() => {
          removeToast(id);
        }, 300);
      }, duration);
    }
  }, [removeToast]);

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
  const { toasts } = useToast();

  return (
    <div className="toast-container">
      <AnimatePresence mode="sync">
        {toasts.filter(t => !t.exiting).map(toast => (
          <motion.div
            key={toast.id}
            className={`toast toast-${toast.type}`}
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.95 }}
            transition={{ duration: 0.25, ease: 'easeInOut' }}
          >
            {toastIcons[toast.type]}
            <div className="toast-content">
              <span className="toast-title">{toast.title}</span>
              {toast.description && <span className="toast-description">{toast.description}</span>}
            </div>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
