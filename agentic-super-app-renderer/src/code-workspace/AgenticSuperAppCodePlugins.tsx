import React, { useState } from 'react'
import { Search } from 'lucide-react'

interface PluginItem {
  id: string
  name: string
  desc: string
  status: 'preview' | 'connected' | 'connect'
  iconText?: string
  iconColor?: string
}

export const AgenticSuperAppCodePlugins: React.FC = () => {
  const [searchQuery, setSearchQuery] = useState('')
  const [plugins, setPlugins] = useState<PluginItem[]>([
    { id: 'x', name: 'X', desc: 'Post, reply, and read your timeline.', status: 'preview', iconText: '𝕏', iconColor: '#ffffff' },
    { id: 'apollo', name: 'Apollo', desc: 'Find leads and enrich contacts mid-task.', status: 'connected', iconText: '✸', iconColor: '#facc15' },
    { id: 'vidiq', name: 'vidIQ', desc: 'Research keywords and read your channel stats.', status: 'connect', iconText: 'vQ', iconColor: '#3b82f6' },
    { id: 'higgsfield', name: 'Higgsfield', desc: 'Generate images and videos with your Higgsfield credits.', status: 'connect', iconText: '∿', iconColor: '#22c55e' },
    { id: 'fal', name: 'fal', desc: 'Generate images and videos with your fal.ai key.', status: 'connect', iconText: '⬡', iconColor: '#38bdf8' },
    { id: 'youtube', name: 'YouTube', desc: 'Read and manage the connected channel.', status: 'connect', iconText: '▶', iconColor: '#ef4444' },
    { id: 'github', name: 'GitHub', desc: 'Read repos, issues, and pull requests with a GitHub PAT.', status: 'connect', iconText: '🐙', iconColor: '#ffffff' },
    { id: 'linear', name: 'Linear', desc: 'Find, create, and update issues, projects, and comments.', status: 'connect', iconText: '◈', iconColor: '#818cf8' },
    { id: 'stripe', name: 'Stripe', desc: 'Read customers, invoices, and the catalog. Charges and refunds stay blocked.', status: 'connect', iconText: 'S', iconColor: '#6366f1' },
    { id: 'cloudflare', name: 'Cloudflare', desc: 'Manage Workers, DNS, R2, and D1 on your account.', status: 'connect', iconText: '☁', iconColor: '#f97316' },
    { id: 'gmail', name: 'Gmail', desc: 'Read and send mail on the connected Google account.', status: 'connect', iconText: 'M', iconColor: '#ef4444' },
    { id: 'supabase', name: 'Supabase', desc: "Inspect and change the builder's Supabase projects.", status: 'connect', iconText: '⚡', iconColor: '#34d399' },
    { id: 'vercel', name: 'Vercel', desc: 'Deploy and manage preview deployments.', status: 'connect', iconText: '▲', iconColor: '#ffffff' },
  ])

  const toggleConnect = (id: string) => {
    setPlugins((prev) =>
      prev.map((item) => {
        if (item.id === id) {
          return {
            ...item,
            status: item.status === 'connect' ? 'connected' : 'connect',
          }
        }
        return item
      })
    )
  }

  const filtered = plugins.filter(
    (p) =>
      p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.desc.toLowerCase().includes(searchQuery.toLowerCase())
  )

  return (
    <div className="code-page-container">
      {/* Search Input */}
      <div className="code-search-box">
        <Search size={15} />
        <input
          type="text"
          className="code-search-input"
          placeholder="Search plugins"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
      </div>

      {/* Plugins List */}
      <section className="code-rows-container">
        {filtered.map((item) => (
          <div key={item.id} className="code-plugin-row">
            <div className="code-activity-left">
              <div className="code-plugin-icon-box" style={{ color: item.iconColor }}>
                {item.iconText}
              </div>
              <div className="code-activity-info">
                <span className="code-activity-title">{item.name}</span>
                <span className="code-activity-desc">{item.desc}</span>
              </div>
            </div>
            <div>
              {item.status === 'preview' && (
                <button type="button" className="code-plugin-btn preview">
                  Preview
                </button>
              )}
              {item.status === 'connected' && (
                <button
                  type="button"
                  className="code-plugin-btn connected"
                  onClick={() => toggleConnect(item.id)}
                >
                  Connected
                </button>
              )}
              {item.status === 'connect' && (
                <button
                  type="button"
                  className="code-plugin-btn connect"
                  onClick={() => toggleConnect(item.id)}
                >
                  Connect
                </button>
              )}
            </div>
          </div>
        ))}
      </section>
    </div>
  )
}
