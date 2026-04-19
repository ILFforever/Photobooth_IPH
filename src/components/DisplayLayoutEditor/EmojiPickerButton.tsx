import { useState, useRef, useEffect } from 'react';
import { EmojiPicker } from 'frimousse';
import './EmojiPickerButton.css';

type SpawnPosition = 'center' | 'top' | 'bottom' | 'left' | 'right' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

interface EmojiPickerButtonProps {
  currentEmoji: string;
  placeholder?: string;
  emojiSize?: number;
  placeholderText?: string;
  onSelect: (emoji: string) => void;
  triggerStyle?: React.CSSProperties;
  popoverStyle?: React.CSSProperties;
  spawnPosition?: SpawnPosition;
  offsetX?: number;
  offsetY?: number;
  children?: React.ReactNode;
  className?: string;
}

export function EmojiPickerButton({
  currentEmoji,
  placeholder = '😊',
  emojiSize = 22,
  placeholderText = 'Change emoji',
  onSelect,
  triggerStyle,
  popoverStyle,
  spawnPosition = 'center',
  offsetX = 0,
  offsetY = 0,
  children,
  className,
}: EmojiPickerButtonProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [popoverY, setPopoverY] = useState(0);
  const [popoverX, setPopoverX] = useState(0);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const pickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: MouseEvent) => {
      if (
        pickerRef.current && !pickerRef.current.contains(e.target as Node) &&
        triggerRef.current && !triggerRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [isOpen]);

  const openPicker = () => {
    if (triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      const pickerHeight = 350;
      const pickerWidth = 320;

      let top = 0;
      let left = 0;

      switch (spawnPosition) {
        case 'center':
          top = rect.top - (pickerHeight / 2) + (rect.height / 2) + offsetY;
          left = rect.left + (rect.width / 2) - (pickerWidth / 2) + offsetX;
          break;
        case 'top':
          top = rect.top - pickerHeight + offsetY;
          left = rect.left + (rect.width / 2) - (pickerWidth / 2) + offsetX;
          break;
        case 'bottom':
          top = rect.bottom + offsetY;
          left = rect.left + (rect.width / 2) - (pickerWidth / 2) + offsetX;
          break;
        case 'left':
          top = rect.top + (rect.height / 2) - (pickerHeight / 2) + offsetY;
          left = rect.left - pickerWidth + offsetX;
          break;
        case 'right':
          top = rect.top + (rect.height / 2) - (pickerHeight / 2) + offsetY;
          left = rect.right + offsetX;
          break;
        case 'top-left':
          top = rect.top - pickerHeight + offsetY;
          left = rect.left - pickerWidth + offsetX;
          break;
        case 'top-right':
          top = rect.top - pickerHeight + offsetY;
          left = rect.right + offsetX;
          break;
        case 'bottom-left':
          top = rect.bottom + offsetY;
          left = rect.left - pickerWidth + offsetX;
          break;
        case 'bottom-right':
          top = rect.bottom + offsetY;
          left = rect.right + offsetX;
          break;
       }
 
       setPopoverY(top);
      setPopoverX(left);
    }
    setIsOpen((open: boolean) => !open);
  };

  return (
    <>
      <button
        ref={triggerRef}
        className={className || "emoji-picker-trigger"}
        onClick={openPicker}
        style={triggerStyle}
      >
        {children || (
          <>
            <span style={{ fontSize: emojiSize, lineHeight: 1 }}>
              {currentEmoji || placeholder}
            </span>
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              {placeholderText}
            </span>
          </>
        )}
      </button>

      {isOpen && (
        <div
          ref={pickerRef}
          className="emoji-picker-popover"
          style={{ top: popoverY, left: popoverX, zIndex: 99999, ...popoverStyle }}
        >
          <EmojiPicker.Root
            className="ep-root"
            onEmojiSelect={({ emoji }) => {
              onSelect(emoji);
              setIsOpen(false);
            }}
          >
            <EmojiPicker.Search className="ep-search" />
            <EmojiPicker.Viewport className="ep-viewport">
              <EmojiPicker.Loading className="ep-status">Loading…</EmojiPicker.Loading>
              <EmojiPicker.Empty className="ep-status">No emoji found.</EmojiPicker.Empty>
              <EmojiPicker.List
                className="ep-list"
                components={{
                  CategoryHeader: ({ category, ...props }) => (
                    <div className="ep-category-header" {...props}>
                      {category.label}
                    </div>
                  ),
                  Row: (props) => <div className="ep-row" {...props} />,
                  Emoji: ({ emoji, ...props }) => (
                    <button
                      className={`ep-emoji${emoji.isActive ? ' active' : ''}`}
                      {...props}
                    >
                      {emoji.emoji}
                    </button>
                  ),
                }}
              />
            </EmojiPicker.Viewport>
          </EmojiPicker.Root>
        </div>
      )}
    </>
  );
}
