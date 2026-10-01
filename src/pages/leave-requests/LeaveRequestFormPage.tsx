import { useQuery } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { RecordHeader } from '@/components/record/Record'
import { LeaveRequestForm } from '@/components/leave/LeaveRequestForm'
import type { LeaveRequest } from '@/types/database'

// HR recording leave for someone, or correcting a request. Staff ask for
// their own leave from My Leave, which uses the same form.
export default function LeaveRequestFormPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const isEdit = !!id
  const { data: record, isLoading } = useQuery({
    queryKey: ['leave-request', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('leave_requests').select('*, staff:staff_id(employee_name)').eq('id', id!).single()
      if (error) throw error
      return data as LeaveRequest & { staff: { employee_name: string } | null }
    },
    enabled: isEdit,
  })

  return (
    <div className="pb-20 sm:pb-0">
      <RecordHeader
        back={{ to: '/leave-requests', label: 'Leave' }}
        title={isEdit ? `Leave for ${record?.staff?.employee_name ?? '…'}` : 'Record leave'}
        subtitle={isEdit ? undefined : 'For someone who asked in person, or leave already taken'}
      />
      {isEdit && isLoading ? (
        <div className="py-16 text-center text-sm text-slate-400">Loading…</div>
      ) : (
        <LeaveRequestForm key={record?.id ?? 'new'} mode="hr" record={record} onSaved={() => navigate('/leave-requests')} onCancel={() => navigate('/leave-requests')} />
      )}
    </div>
  )
}
