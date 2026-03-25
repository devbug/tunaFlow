# tunaFlow — Technical Implementation Guide

## Component Tree

```
src/app/
├── page.tsx (renders AppShell)
├── layout.tsx (metadata, fonts)
├── globals.css (design tokens, animations)

src/components/tunaflow/
├── AppShell.tsx ✨ RESTRUCTURED
│   ├─ Sidebar
│   ├─ ChatPanel
│   └─ BranchThreadPanel (conditional render)
│
├── StatusBar.tsx 🆕 NEW
│   └─ Shows: Mode, Branch, Agents, Skills, Integrations
│
├── ChatPanel.tsx ✨ UPDATED
│   ├─ StatusBar (new)
│   ├─ Header (simplified)
│   ├─ Stream/Roundtable toggle
│   ├─ MessageItem (enhanced)
│   ├─ RoundtableView (enhanced)
│   └─ MessageInput (enhanced)
│
├── BranchThreadPanel.tsx 🆕 NEW
│   ├─ Header (branch name, parent context)
│   ├─ MessageItem (compact variant)
│   └─ Footer (Close, Adopt buttons)
│
├── MessageItem.tsx ✨ UPDATED
│   └─ New prop: variant ("default" | "compact")
│   └─ Enhanced hover styling
│   └─ Branch action emphasized
│
├── MessageInput.tsx ✨ UPDATED
│   └─ Mode display bar
│   └─ Branch state indicator
│   └─ Updated props for branch object
│
├── RoundtableView.tsx ✨ UPDATED
│   └─ Enhanced round styling
│   └─ Relationship indicators
│   └─ Better visual hierarchy
│
├── ChatPanel.tsx (unchanged)
├── Sidebar.tsx (unchanged)

src/lib/
├── tunaflow-types.ts (unchanged)
└── tunaflow-data.ts (unchanged)
```

---

## State Management

### AppShell State
```typescript
const [activeConversationId, setActiveConversationId] = useState("c1");
const [activeBranch, setActiveBranch] = useState<{ id: string; label: string } | null>(null);
const [branchThreadOpen, setBranchThreadOpen] = useState(false);
```

**State Flow:**
1. User clicks "Branch" on message → calls `onBranchClick(branchId, label)`
2. AppShell updates: `setActiveBranch({ id, label })` + `setBranchThreadOpen(true)`
3. Conditions render: `{branchThreadOpen && activeBranch && <BranchThreadPanel ... />}`
4. User clicks "Close" → `setBranchThreadOpen(false)` + delayed `setActiveBranch(null)`

### Props Passing
```typescript
// AppShell → ChatPanel
<ChatPanel 
  activeBranch={activeBranch}
  onBranchClick={handleBranchClick}
/>

// ChatPanel → MessageItem
<MessageItem 
  onBranch={(msgId) => onBranchClick("b_temp", "Quick Branch")}
/>

// ChatPanel → MessageInput  
<MessageInput 
  activeBranch={activeBranch}
/>
```

---

## Key Type Updates

### Before (Old AppShell)
```typescript
activeBranch: string | null  // just a label
onBranch: (messageId: string) => void
```

### After (New AppShell)
```typescript
activeBranch: { id: string; label: string } | null  // full branch object
onBranchClick: (branchId: string, label: string) => void
```

---

## New Components

### StatusBar.tsx
```typescript
interface StatusBarProps {
  mode: "chat" | "roundtable";
  branch?: { id: string; label: string } | null;
  agentCount?: number;
  activeSkills?: number;
  activeIntegrations?: number;
  roundCount?: number;
}

export function StatusBar({ mode, branch, ... }: StatusBarProps) {
  // Renders compact badge-style status indicators
  // Always visible, read-only (state managed by parent)
}
```

### BranchThreadPanel.tsx
```typescript
interface BranchThreadPanelProps {
  branch: { id: string; label: string };
  onClose: () => void;
  onAdopt: () => void;
}

export function BranchThreadPanel({ branch, onClose, onAdopt }: BranchThreadPanelProps) {
  // Overlay panel that slides in from right
  // Shows branch-specific thread of messages
  // Compact MessageItem variant
  // Adopt button to apply branch state
}
```

---

## CSS Additions

### globals.css
```css
@keyframes slide-in-from-right {
  from { transform: translateX(100%); opacity: 0; }
  to { transform: translateX(0); opacity: 1; }
}

@theme inline {
  --animate-slide-in-from-right-96: 
    slide-in-from-right 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}
```

### BranchThreadPanel.tsx
```tsx
<div className="fixed inset-y-0 right-0 w-96 animate-in slide-in-from-right-96 ...">
  {/* Panel content */}
</div>
```

---

## MessageItem Compact Variant

### Props
```typescript
interface MessageItemProps {
  message: Message;
  variant?: "default" | "compact";  // NEW
  ...
}
```

### Usage
```tsx
// In ChatPanel (Stream view)
<MessageItem message={msg} variant="default" />

// In BranchThreadPanel (Thread view)
<MessageItem message={msg} variant="compact" />
```

### Styling Changes
- Avatar: `w-7 h-7` (default) → `w-5 h-5` (compact)
- Text: `text-sm` (default) → `text-xs` (compact)
- Padding: `px-4 py-3` (default) → `px-3 py-2` (compact)
- Content: Full text (default) → `line-clamp-2` (compact)

---

## Component Communication

### MessageItem → AppShell (via ChatPanel)
```typescript
// User clicks Branch button on message
<button onClick={() => onBranch?.(message.id)}>
  Branch
</button>

// ChatPanel receives callback
onBranch={(msgId) => {
  onBranchClick("b_temp", "Quick Branch from Message");
}}

// AppShell handles the click
const handleBranchClick = (branchId: string, label: string) => {
  setActiveBranch({ id: branchId, label });
  setBranchThreadOpen(true);
};
```

### BranchThreadPanel → AppShell
```typescript
// User clicks Adopt
<button onClick={onAdopt}>Adopt</button>

// AppShell handler
const handleAdoptBranch = () => {
  // Perform adoption logic here
  handleCloseBranch();
};
```

---

## Animation Behavior

### Branch Panel Entry
- Trigger: `branchThreadOpen && activeBranch`
- Duration: 300ms
- Easing: `cubic-bezier(0.4, 0, 0.2, 1)` (Material Design acceleration)
- Direction: Slide in from right (100% → 0%)

### Branch Panel Exit
- Trigger: User clicks Close
- Manual timing: `setBranchThreadOpen(false)` immediately
- Visual: CSS handles fade-out via conditional render unmount
- Delay for state clear: `setTimeout(() => setActiveBranch(null), 300)`

---

## Performance Considerations

### Memoization
No memoization currently needed:
- StatusBar: Pure presentation, re-renders on prop change (expected)
- BranchThreadPanel: Only renders when `branchThreadOpen === true`
- MessageItem: Renders all messages in view (consider virtualization if >100 messages)

### Optimization Opportunities
1. Virtualize long message lists with `react-window`
2. Memoize `RoundtableView` with `React.memo`
3. Lazy-load BranchThreadPanel component

---

## Testing Considerations

### Unit Tests to Write
```typescript
// StatusBar.test.tsx
describe("StatusBar", () => {
  it("renders mode badge correctly");
  it("shows branch state when active");
  it("displays agent count");
});

// BranchThreadPanel.test.tsx
describe("BranchThreadPanel", () => {
  it("renders branch name correctly");
  it("calls onClose when close button clicked");
  it("calls onAdopt when adopt button clicked");
});

// MessageItem.test.tsx
describe("MessageItem", () => {
  it("renders compact variant with smaller text");
  it("shows branch count in action button");
  it("calls onBranch with message id");
});
```

### Integration Tests
```typescript
// Branching workflow
describe("Branching Workflow", () => {
  it("opens branch panel on branch click");
  it("shows thread messages in panel");
  it("closes panel on adopt");
  it("updates main chat state on adopt");
});
```

---

## Browser Support

- Chrome/Edge: ✅ Full support
- Firefox: ✅ Full support
- Safari: ✅ Full support (including fixed positioning)
- Mobile: ⚠️ Needs responsive redesign (thread panel as modal)

---

## Accessibility Checklist

- [ ] All buttons have accessible labels
- [ ] Status bar content announced to screen readers
- [ ] Branch thread panel has `role="complementary"`
- [ ] Keyboard navigation works (Tab, Shift+Tab, Escape)
- [ ] Color contrast meets WCAG AA
- [ ] Animations respect `prefers-reduced-motion`

---

## Future Enhancements

### Phase 2 (Immediate)
- [ ] Branch merge/delete functionality
- [ ] Branch comparison view (side-by-side)
- [ ] Save branch to artifact workflow
- [ ] Roundtable participant selector

### Phase 3 (Medium term)
- [ ] Mobile responsive thread panel
- [ ] Branch history timeline
- [ ] Collaboration features (share branch)
- [ ] Skill quick toggle in StatusBar

### Phase 4 (Long term)
- [ ] Undo/Redo with branch state
- [ ] Search within branches
- [ ] Cross-session context merging
- [ ] Real-time collaboration

---

## Deployment Notes

- No breaking API changes
- All changes are UI/UX only
- Mock data structure unchanged
- Drop-in replacement (safe to deploy)

---

## Code Review Checklist

- [ ] No console.log statements left
- [ ] All imports are used
- [ ] Component props are typed
- [ ] CSS classes use `cn()` for conditionals
- [ ] Accessibility attributes present
- [ ] Mobile responsive (future)
- [ ] Performance optimized (no unnecessary renders)
- [ ] Error boundaries considered
- [ ] Loading states handled
