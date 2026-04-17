import { useEffect } from 'react';
import { DisplayLayoutSidebar } from './DisplayLayoutSidebar';
import { DisplayCanvas } from './DisplayCanvas';
import { useDisplayLayout } from '../../contexts/display/DisplayLayoutContext';
import './DisplayLayoutEditor.css';

export function DisplayLayoutEditor() {
  const { selectedElementId, removeElement } = useDisplayLayout();

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Delete') return;
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (!selectedElementId) return;
      removeElement(selectedElementId);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [selectedElementId, removeElement]);

  return (
    <div className="display-layout-editor">
      <DisplayLayoutSidebar />
      <DisplayCanvas />
    </div>
  );
}
