# Git review controls

Owns DX Git-review UI and orchestration. Keep integrations in shared screens small:

```tsx
<ThreadDiffControl {...props} />
<ReviewChangesSidebar {...props} />
<GitSettingsSection />
```

Generic diff rendering, stores, transport state, and contracts stay outside this directory.
