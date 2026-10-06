import React, { useState, useEffect, useCallback } from 'react'
import { Plus, Pencil, Trash2, EyeOff, Eye } from 'lucide-react'
import { supabase } from '../lib/supabase'
import Modal from '../components/Modal'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import PasswordConfirmDialog from '../components/PasswordConfirmDialog'

function friendlyError(error) {
  if (error.code === '23505') return 'A category with that name already exists.'
  if (error.code === '23503') return 'This category still has products. Move them to another category first.'
  if (error.code === '42P01') return 'Categories table not found. Run migration 009 in the Supabase SQL editor.'
  return error.message
}

function CategoryForm({ category, onSaved, onClose }) {
  const [name, setName] = useState(category?.name || '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const isEdit = Boolean(category?.id)

  async function handleSubmit(e) {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) return
    setSaving(true)
    setError(null)
    // Renaming cascades to every product in the category (FK ON UPDATE CASCADE)
    const { error } = isEdit
      ? await supabase.from('categories').update({ name: trimmed }).eq('id', category.id)
      : await supabase.from('categories').insert({ name: trimmed })
    setSaving(false)
    if (error) return setError(friendlyError(error))
    onSaved(isEdit ? 'Category renamed' : 'Category added')
  }

  return (
    <Modal
      title={isEdit ? 'Edit category' : 'Add category'}
      description={isEdit ? 'Renaming also updates every product in this category.' : 'Product types you can file products under, e.g. Dairy or Snacks.'}
      onClose={onClose}
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        {error && <div className="alert-error mb-0">{error}</div>}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="cat-name">Name</Label>
          <Input id="cat-name" autoFocus value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Beverages" />
        </div>
        <div className="flex gap-2 justify-end">
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={!name.trim() || saving || name.trim() === category?.name}>
            {saving ? 'Saving...' : isEdit ? 'Save changes' : 'Add category'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}

export default function Categories() {
  const [categories, setCategories] = useState([])
  const [counts, setCounts]         = useState({})
  const [loading, setLoading]       = useState(true)
  const [loadError, setLoadError]   = useState(null)
  const [editing, setEditing]       = useState(null)   // {} for new, category for edit
  const [deleting, setDeleting]     = useState(null)
  const [toast, setToast]           = useState(null)

  const flash = msg => { setToast(msg); setTimeout(() => setToast(null), 2600) }

  const fetchAll = useCallback(async () => {
    const [{ data: cats, error }, { data: prods }] = await Promise.all([
      supabase.from('categories').select('*').order('name'),
      supabase.from('products').select('category'),
    ])
    setLoadError(error ? friendlyError(error) : null)
    setCategories(cats || [])
    const c = {}
    ;(prods || []).forEach(p => { c[p.category] = (c[p.category] || 0) + 1 })
    setCounts(c)
    setLoading(false)
  }, [])

  useEffect(() => { fetchAll() }, [fetchAll])

  async function toggleActive(cat) {
    const { error } = await supabase.from('categories').update({ active: !cat.active }).eq('id', cat.id)
    if (error) return flash(friendlyError(error))
    flash(cat.active ? `${cat.name} deactivated` : `${cat.name} reactivated`)
    fetchAll()
  }

  // Returns an error message for the confirm dialog, or nothing on success
  async function handleDelete() {
    const cat = deleting
    const { data, error } = await supabase.from('categories').delete().eq('id', cat.id).select('id')
    if (error) return friendlyError(error)
    if (!data?.length) return 'Not deleted. Only managers and owners can delete categories.'
    flash(`${cat.name} deleted`)
    fetchAll()
  }

  const deletingCount = deleting ? counts[deleting.name] || 0 : 0

  return (
    <div className="page" style={{ maxWidth: 860 }}>
      <header className="page-head">
        <h1>Categories</h1>
        <Button onClick={() => setEditing({})}><Plus /> Add category</Button>
      </header>
      <p className="page-sub">
        Product types for your inventory. Deactivated categories, and their products, are hidden from the register.
      </p>

      {loadError && <div className="alert-error">{loadError}</div>}

      <div className="table-card">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Name</TableHead>
              <TableHead className="text-right">Products</TableHead>
              <TableHead className="text-right"><span className="sr-only">Actions</span></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && (
              <TableRow className="hover:bg-transparent"><TableCell colSpan={3} className="empty-grid">Loading...</TableCell></TableRow>
            )}
            {!loading && categories.length === 0 && !loadError && (
              <TableRow className="hover:bg-transparent"><TableCell colSpan={3} className="empty-grid">No categories yet.</TableCell></TableRow>
            )}
            {categories.map(c => (
              <TableRow key={c.id} className={c.active ? '' : 'opacity-50'}>
                <TableCell className="font-semibold">
                  {c.name}
                  {!c.active && <span className="ml-2 text-xs font-medium text-muted">(inactive)</span>}
                </TableCell>
                <TableCell className="num text-ink-2">{counts[c.name] || 0}</TableCell>
                <TableCell>
                  <div className="flex gap-1 justify-end">
                    <Button size="sm" variant="ghost" className="text-accent hover:text-accent" onClick={() => setEditing(c)}>
                      <Pencil /> Edit
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => toggleActive(c)}>
                      {c.active ? <><EyeOff /> Deactivate</> : <><Eye /> Activate</>}
                    </Button>
                    <Button size="sm" variant="ghost" className="text-red hover:text-red hover:bg-red-tint" onClick={() => setDeleting(c)}>
                      <Trash2 /> Delete
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {editing && (
        <CategoryForm
          category={editing}
          onClose={() => setEditing(null)}
          onSaved={msg => { setEditing(null); flash(msg); fetchAll() }}
        />
      )}

      <PasswordConfirmDialog
        open={Boolean(deleting)}
        onOpenChange={open => { if (!open) setDeleting(null) }}
        title={`Delete "${deleting?.name}"?`}
        description={deletingCount > 0
          ? `This category still has ${deletingCount} product${deletingCount === 1 ? '' : 's'}. Move them to another category first, or deactivate the category instead.`
          : 'This permanently removes the category. This cannot be undone.'}
        canConfirm={deletingCount === 0}
        confirmLabel="Delete category"
        onConfirm={handleDelete}
      />

      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}
