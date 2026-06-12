export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      access_levels: {
        Row: {
          created_at: string
          description: string | null
          key: string
          label: string
          sort_order: number
        }
        Insert: {
          created_at?: string
          description?: string | null
          key: string
          label: string
          sort_order?: number
        }
        Update: {
          created_at?: string
          description?: string | null
          key?: string
          label?: string
          sort_order?: number
        }
        Relationships: []
      }
      admin_audit_log: {
        Row: {
          action: string
          actor_role: string | null
          actor_user_id: string | null
          after: Json | null
          before: Json | null
          created_at: string
          id: string
          ip: string | null
          summary: string | null
          target_id: string | null
          target_table: string | null
          user_agent: string | null
        }
        Insert: {
          action: string
          actor_role?: string | null
          actor_user_id?: string | null
          after?: Json | null
          before?: Json | null
          created_at?: string
          id?: string
          ip?: string | null
          summary?: string | null
          target_id?: string | null
          target_table?: string | null
          user_agent?: string | null
        }
        Update: {
          action?: string
          actor_role?: string | null
          actor_user_id?: string | null
          after?: Json | null
          before?: Json | null
          created_at?: string
          id?: string
          ip?: string | null
          summary?: string | null
          target_id?: string | null
          target_table?: string | null
          user_agent?: string | null
        }
        Relationships: []
      }
      agreement_audit_log: {
        Row: {
          actor_role: string
          actor_user_id: string | null
          agreement_id: string
          created_at: string
          details: Json
          event: string
          id: string
          ip: string | null
          signer_email: string | null
          signer_name: string | null
          user_agent: string | null
        }
        Insert: {
          actor_role: string
          actor_user_id?: string | null
          agreement_id: string
          created_at?: string
          details?: Json
          event: string
          id?: string
          ip?: string | null
          signer_email?: string | null
          signer_name?: string | null
          user_agent?: string | null
        }
        Update: {
          actor_role?: string
          actor_user_id?: string | null
          agreement_id?: string
          created_at?: string
          details?: Json
          event?: string
          id?: string
          ip?: string | null
          signer_email?: string | null
          signer_name?: string | null
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "agreement_audit_log_agreement_id_fkey"
            columns: ["agreement_id"]
            isOneToOne: false
            referencedRelation: "agreements"
            referencedColumns: ["id"]
          },
        ]
      }
      agreement_templates: {
        Row: {
          agreement_type: string | null
          archived: boolean
          archived_at: string | null
          archived_by: string | null
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          is_active: boolean
          last_used_at: string | null
          name: string
          notes: string | null
          signnow_template_id: string | null
          signnow_url: string | null
          times_completed: number
          times_sent: number
          updated_at: string
          version: string
        }
        Insert: {
          agreement_type?: string | null
          archived?: boolean
          archived_at?: string | null
          archived_by?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_active?: boolean
          last_used_at?: string | null
          name: string
          notes?: string | null
          signnow_template_id?: string | null
          signnow_url?: string | null
          times_completed?: number
          times_sent?: number
          updated_at?: string
          version?: string
        }
        Update: {
          agreement_type?: string | null
          archived?: boolean
          archived_at?: string | null
          archived_by?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_active?: boolean
          last_used_at?: string | null
          name?: string
          notes?: string | null
          signnow_template_id?: string | null
          signnow_url?: string | null
          times_completed?: number
          times_sent?: number
          updated_at?: string
          version?: string
        }
        Relationships: []
      }
      agreements: {
        Row: {
          admin_notes: string | null
          agreement_type: string | null
          archive_reason: string | null
          archived: boolean
          archived_at: string | null
          archived_by: string | null
          cancelled_at: string | null
          client_address: string | null
          client_dob: string | null
          client_email: string | null
          client_full_name: string | null
          client_id: string
          client_marked_complete_at: string | null
          client_marked_complete_by: string | null
          client_phone: string | null
          completed_at: string | null
          correct_client_name: string | null
          created_at: string
          created_by: string | null
          drive_file_id: string | null
          drive_file_url: string | null
          expires_at: string | null
          id: string
          last_reminder_at: string | null
          offer_name: string | null
          opened_at: string | null
          purchase_record_id: string | null
          sent_at: string | null
          signed_at: string | null
          signed_copy_storage_path: string | null
          signed_copy_url: string | null
          signed_in_person: boolean
          signed_pdf_pulled_at: string | null
          signer_mismatch: boolean
          signer_name_in_signnow: string | null
          signing_method: string | null
          signnow_completed_link: string | null
          signnow_document_id: string | null
          signnow_signing_link: string | null
          signnow_template_id: string | null
          status: string
          template_id: string | null
          template_name: string
          updated_at: string
          verification_note: string | null
          verification_status: string
          verified_at: string | null
          verified_by: string | null
          webhook_last_event: string | null
          webhook_last_event_at: string | null
        }
        Insert: {
          admin_notes?: string | null
          agreement_type?: string | null
          archive_reason?: string | null
          archived?: boolean
          archived_at?: string | null
          archived_by?: string | null
          cancelled_at?: string | null
          client_address?: string | null
          client_dob?: string | null
          client_email?: string | null
          client_full_name?: string | null
          client_id: string
          client_marked_complete_at?: string | null
          client_marked_complete_by?: string | null
          client_phone?: string | null
          completed_at?: string | null
          correct_client_name?: string | null
          created_at?: string
          created_by?: string | null
          drive_file_id?: string | null
          drive_file_url?: string | null
          expires_at?: string | null
          id?: string
          last_reminder_at?: string | null
          offer_name?: string | null
          opened_at?: string | null
          purchase_record_id?: string | null
          sent_at?: string | null
          signed_at?: string | null
          signed_copy_storage_path?: string | null
          signed_copy_url?: string | null
          signed_in_person?: boolean
          signed_pdf_pulled_at?: string | null
          signer_mismatch?: boolean
          signer_name_in_signnow?: string | null
          signing_method?: string | null
          signnow_completed_link?: string | null
          signnow_document_id?: string | null
          signnow_signing_link?: string | null
          signnow_template_id?: string | null
          status?: string
          template_id?: string | null
          template_name: string
          updated_at?: string
          verification_note?: string | null
          verification_status?: string
          verified_at?: string | null
          verified_by?: string | null
          webhook_last_event?: string | null
          webhook_last_event_at?: string | null
        }
        Update: {
          admin_notes?: string | null
          agreement_type?: string | null
          archive_reason?: string | null
          archived?: boolean
          archived_at?: string | null
          archived_by?: string | null
          cancelled_at?: string | null
          client_address?: string | null
          client_dob?: string | null
          client_email?: string | null
          client_full_name?: string | null
          client_id?: string
          client_marked_complete_at?: string | null
          client_marked_complete_by?: string | null
          client_phone?: string | null
          completed_at?: string | null
          correct_client_name?: string | null
          created_at?: string
          created_by?: string | null
          drive_file_id?: string | null
          drive_file_url?: string | null
          expires_at?: string | null
          id?: string
          last_reminder_at?: string | null
          offer_name?: string | null
          opened_at?: string | null
          purchase_record_id?: string | null
          sent_at?: string | null
          signed_at?: string | null
          signed_copy_storage_path?: string | null
          signed_copy_url?: string | null
          signed_in_person?: boolean
          signed_pdf_pulled_at?: string | null
          signer_mismatch?: boolean
          signer_name_in_signnow?: string | null
          signing_method?: string | null
          signnow_completed_link?: string | null
          signnow_document_id?: string | null
          signnow_signing_link?: string | null
          signnow_template_id?: string | null
          status?: string
          template_id?: string | null
          template_name?: string
          updated_at?: string
          verification_note?: string | null
          verification_status?: string
          verified_at?: string | null
          verified_by?: string | null
          webhook_last_event?: string | null
          webhook_last_event_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "agreements_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agreements_purchase_record_id_fkey"
            columns: ["purchase_record_id"]
            isOneToOne: false
            referencedRelation: "purchase_records"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agreements_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "agreement_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      app_members: {
        Row: {
          account_type: string
          admin_notes: string | null
          avatar_url: string | null
          cancel_at: string | null
          cancelled_at: string | null
          created_at: string
          current_period_end: string | null
          email: string
          full_name: string | null
          hold_plan_started_at: string | null
          id: string
          is_admin_sandbox: boolean
          last_active_at: string | null
          last_billing_event_at: string | null
          last_invoice_status: string | null
          last_signed_in_at: string | null
          messaging_permission: string
          paused_until: string | null
          phone: string | null
          profile_picture_required: boolean
          setup_token: string | null
          setup_token_expires_at: string | null
          signup_ip: string | null
          signup_user_agent: string | null
          sms_opt_out: boolean
          status: string
          stripe_customer_id: string | null
          stripe_price_id: string | null
          stripe_subscription_id: string | null
          subscription_status: string | null
          trial_end_at: string | null
          updated_at: string
          user_id: string | null
        }
        Insert: {
          account_type?: string
          admin_notes?: string | null
          avatar_url?: string | null
          cancel_at?: string | null
          cancelled_at?: string | null
          created_at?: string
          current_period_end?: string | null
          email: string
          full_name?: string | null
          hold_plan_started_at?: string | null
          id?: string
          is_admin_sandbox?: boolean
          last_active_at?: string | null
          last_billing_event_at?: string | null
          last_invoice_status?: string | null
          last_signed_in_at?: string | null
          messaging_permission?: string
          paused_until?: string | null
          phone?: string | null
          profile_picture_required?: boolean
          setup_token?: string | null
          setup_token_expires_at?: string | null
          signup_ip?: string | null
          signup_user_agent?: string | null
          sms_opt_out?: boolean
          status?: string
          stripe_customer_id?: string | null
          stripe_price_id?: string | null
          stripe_subscription_id?: string | null
          subscription_status?: string | null
          trial_end_at?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          account_type?: string
          admin_notes?: string | null
          avatar_url?: string | null
          cancel_at?: string | null
          cancelled_at?: string | null
          created_at?: string
          current_period_end?: string | null
          email?: string
          full_name?: string | null
          hold_plan_started_at?: string | null
          id?: string
          is_admin_sandbox?: boolean
          last_active_at?: string | null
          last_billing_event_at?: string | null
          last_invoice_status?: string | null
          last_signed_in_at?: string | null
          messaging_permission?: string
          paused_until?: string | null
          phone?: string | null
          profile_picture_required?: boolean
          setup_token?: string | null
          setup_token_expires_at?: string | null
          signup_ip?: string | null
          signup_user_agent?: string | null
          sms_opt_out?: boolean
          status?: string
          stripe_customer_id?: string | null
          stripe_price_id?: string | null
          stripe_subscription_id?: string | null
          subscription_status?: string | null
          trial_end_at?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Relationships: []
      }
      app_settings: {
        Row: {
          created_at: string | null
          id: string
          key: string
          updated_at: string | null
          value: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          key: string
          updated_at?: string | null
          value?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          key?: string
          updated_at?: string | null
          value?: string | null
        }
        Relationships: []
      }
      app_shortcuts: {
        Row: {
          created_at: string
          description: string | null
          id: string
          name: string
          notes: string | null
          sort_order: number | null
          url: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          name: string
          notes?: string | null
          sort_order?: number | null
          url: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          notes?: string | null
          sort_order?: number | null
          url?: string
        }
        Relationships: []
      }
      appointment_audit_log: {
        Row: {
          action: string
          actor_user_id: string | null
          appointment_id: string
          created_at: string
          details: Json
          id: string
        }
        Insert: {
          action: string
          actor_user_id?: string | null
          appointment_id: string
          created_at?: string
          details?: Json
          id?: string
        }
        Update: {
          action?: string
          actor_user_id?: string | null
          appointment_id?: string
          created_at?: string
          details?: Json
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "appointment_audit_log_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
        ]
      }
      appointment_reminders: {
        Row: {
          appointment_id: string
          audience: Database["public"]["Enums"]["reminder_audience"]
          created_at: string
          error: string | null
          id: string
          offset_minutes: number
          scheduled_for: string
          sent_at: string | null
          status: Database["public"]["Enums"]["reminder_status"]
        }
        Insert: {
          appointment_id: string
          audience: Database["public"]["Enums"]["reminder_audience"]
          created_at?: string
          error?: string | null
          id?: string
          offset_minutes: number
          scheduled_for: string
          sent_at?: string | null
          status?: Database["public"]["Enums"]["reminder_status"]
        }
        Update: {
          appointment_id?: string
          audience?: Database["public"]["Enums"]["reminder_audience"]
          created_at?: string
          error?: string | null
          id?: string
          offset_minutes?: number
          scheduled_for?: string
          sent_at?: string | null
          status?: Database["public"]["Enums"]["reminder_status"]
        }
        Relationships: [
          {
            foreignKeyName: "appointment_reminders_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
        ]
      }
      appointments: {
        Row: {
          appointment_type: Database["public"]["Enums"]["appointment_type"]
          attendee_notes: string | null
          booking_link_id: string | null
          cancelled_at: string | null
          cancelled_reason: string | null
          client_id: string | null
          created_at: string
          created_by: string | null
          ends_at: string
          external_email: string | null
          external_name: string | null
          external_phone: string | null
          google_calendar_id: string | null
          google_event_id: string | null
          host_coach_id: string
          id: string
          internal_notes: string | null
          location: string | null
          meet_link: string | null
          sms_reminders_enabled: boolean
          source: Database["public"]["Enums"]["appointment_source"]
          starts_at: string
          status: Database["public"]["Enums"]["appointment_status"]
          timezone: string
          title: string
          updated_at: string
        }
        Insert: {
          appointment_type?: Database["public"]["Enums"]["appointment_type"]
          attendee_notes?: string | null
          booking_link_id?: string | null
          cancelled_at?: string | null
          cancelled_reason?: string | null
          client_id?: string | null
          created_at?: string
          created_by?: string | null
          ends_at: string
          external_email?: string | null
          external_name?: string | null
          external_phone?: string | null
          google_calendar_id?: string | null
          google_event_id?: string | null
          host_coach_id: string
          id?: string
          internal_notes?: string | null
          location?: string | null
          meet_link?: string | null
          sms_reminders_enabled?: boolean
          source?: Database["public"]["Enums"]["appointment_source"]
          starts_at: string
          status?: Database["public"]["Enums"]["appointment_status"]
          timezone?: string
          title: string
          updated_at?: string
        }
        Update: {
          appointment_type?: Database["public"]["Enums"]["appointment_type"]
          attendee_notes?: string | null
          booking_link_id?: string | null
          cancelled_at?: string | null
          cancelled_reason?: string | null
          client_id?: string | null
          created_at?: string
          created_by?: string | null
          ends_at?: string
          external_email?: string | null
          external_name?: string | null
          external_phone?: string | null
          google_calendar_id?: string | null
          google_event_id?: string | null
          host_coach_id?: string
          id?: string
          internal_notes?: string | null
          location?: string | null
          meet_link?: string | null
          sms_reminders_enabled?: boolean
          source?: Database["public"]["Enums"]["appointment_source"]
          starts_at?: string
          status?: Database["public"]["Enums"]["appointment_status"]
          timezone?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "appointments_booking_link_id_fkey"
            columns: ["booking_link_id"]
            isOneToOne: false
            referencedRelation: "booking_links"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_host_coach_id_fkey"
            columns: ["host_coach_id"]
            isOneToOne: false
            referencedRelation: "coaches"
            referencedColumns: ["id"]
          },
        ]
      }
      booking_link_availability: {
        Row: {
          booking_link_id: string
          created_at: string
          day_of_week: number
          end_time: string
          id: string
          start_time: string
        }
        Insert: {
          booking_link_id: string
          created_at?: string
          day_of_week: number
          end_time: string
          id?: string
          start_time: string
        }
        Update: {
          booking_link_id?: string
          created_at?: string
          day_of_week?: number
          end_time?: string
          id?: string
          start_time?: string
        }
        Relationships: [
          {
            foreignKeyName: "booking_link_availability_booking_link_id_fkey"
            columns: ["booking_link_id"]
            isOneToOne: false
            referencedRelation: "booking_links"
            referencedColumns: ["id"]
          },
        ]
      }
      booking_links: {
        Row: {
          active: boolean
          allow_cancel: boolean
          allow_reschedule: boolean
          appointment_type: Database["public"]["Enums"]["appointment_type"]
          buffer_after_minutes: number
          buffer_before_minutes: number
          collect_notes: boolean
          collect_phone: boolean
          created_at: string
          created_by: string | null
          description: string | null
          duration_minutes: number
          host_coach_id: string
          id: string
          max_advance_days: number
          max_per_day: number | null
          meet_enabled: boolean
          min_notice_hours: number
          name: string
          reminder_offsets_minutes: number[]
          slug: string
          sms_reminders_enabled: boolean
          timezone: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          allow_cancel?: boolean
          allow_reschedule?: boolean
          appointment_type?: Database["public"]["Enums"]["appointment_type"]
          buffer_after_minutes?: number
          buffer_before_minutes?: number
          collect_notes?: boolean
          collect_phone?: boolean
          created_at?: string
          created_by?: string | null
          description?: string | null
          duration_minutes?: number
          host_coach_id: string
          id?: string
          max_advance_days?: number
          max_per_day?: number | null
          meet_enabled?: boolean
          min_notice_hours?: number
          name: string
          reminder_offsets_minutes?: number[]
          slug: string
          sms_reminders_enabled?: boolean
          timezone?: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          allow_cancel?: boolean
          allow_reschedule?: boolean
          appointment_type?: Database["public"]["Enums"]["appointment_type"]
          buffer_after_minutes?: number
          buffer_before_minutes?: number
          collect_notes?: boolean
          collect_phone?: boolean
          created_at?: string
          created_by?: string | null
          description?: string | null
          duration_minutes?: number
          host_coach_id?: string
          id?: string
          max_advance_days?: number
          max_per_day?: number | null
          meet_enabled?: boolean
          min_notice_hours?: number
          name?: string
          reminder_offsets_minutes?: number[]
          slug?: string
          sms_reminders_enabled?: boolean
          timezone?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "booking_links_host_coach_id_fkey"
            columns: ["host_coach_id"]
            isOneToOne: false
            referencedRelation: "coaches"
            referencedColumns: ["id"]
          },
        ]
      }
      broadcast_recipients: {
        Row: {
          broadcast_id: string
          client_id: string
          created_at: string
          id: string
        }
        Insert: {
          broadcast_id: string
          client_id: string
          created_at?: string
          id?: string
        }
        Update: {
          broadcast_id?: string
          client_id?: string
          created_at?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "broadcast_recipients_broadcast_id_fkey"
            columns: ["broadcast_id"]
            isOneToOne: false
            referencedRelation: "broadcasts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "broadcast_recipients_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      broadcast_seen: {
        Row: {
          broadcast_id: string
          created_at: string
          got_it_at: string
          id: string
          user_id: string
        }
        Insert: {
          broadcast_id: string
          created_at?: string
          got_it_at?: string
          id?: string
          user_id: string
        }
        Update: {
          broadcast_id?: string
          created_at?: string
          got_it_at?: string
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "broadcast_seen_broadcast_id_fkey"
            columns: ["broadcast_id"]
            isOneToOne: false
            referencedRelation: "broadcasts"
            referencedColumns: ["id"]
          },
        ]
      }
      broadcasts: {
        Row: {
          audience_scope: string
          author_id: string | null
          body: string
          created_at: string
          expires_at: string | null
          id: string
          link_label: string | null
          link_url: string | null
          publish_at: string
          review_notes: string | null
          review_status: Database["public"]["Enums"]["review_status"]
          reviewed_at: string | null
          reviewed_by: string | null
          status: string
          submitted_at: string | null
          submitted_by: string | null
          title: string
          transcript: string | null
          type: string
          updated_at: string
          video_path: string | null
          video_url: string | null
          voice_path: string | null
          voice_url: string | null
        }
        Insert: {
          audience_scope?: string
          author_id?: string | null
          body?: string
          created_at?: string
          expires_at?: string | null
          id?: string
          link_label?: string | null
          link_url?: string | null
          publish_at?: string
          review_notes?: string | null
          review_status?: Database["public"]["Enums"]["review_status"]
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          submitted_at?: string | null
          submitted_by?: string | null
          title: string
          transcript?: string | null
          type?: string
          updated_at?: string
          video_path?: string | null
          video_url?: string | null
          voice_path?: string | null
          voice_url?: string | null
        }
        Update: {
          audience_scope?: string
          author_id?: string | null
          body?: string
          created_at?: string
          expires_at?: string | null
          id?: string
          link_label?: string | null
          link_url?: string | null
          publish_at?: string
          review_notes?: string | null
          review_status?: Database["public"]["Enums"]["review_status"]
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          submitted_at?: string | null
          submitted_by?: string | null
          title?: string
          transcript?: string | null
          type?: string
          updated_at?: string
          video_path?: string | null
          video_url?: string | null
          voice_path?: string | null
          voice_url?: string | null
        }
        Relationships: []
      }
      cardio_program_templates: {
        Row: {
          archived: boolean
          archived_at: string | null
          archived_by: string | null
          created_at: string
          created_by: string | null
          id: string
          name: string
          notes: string | null
          rows: Json
          updated_at: string
        }
        Insert: {
          archived?: boolean
          archived_at?: string | null
          archived_by?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          notes?: string | null
          rows?: Json
          updated_at?: string
        }
        Update: {
          archived?: boolean
          archived_at?: string | null
          archived_by?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          notes?: string | null
          rows?: Json
          updated_at?: string
        }
        Relationships: []
      }
      cardio_targets: {
        Row: {
          admin_notes: string | null
          calorie_target_max: number | null
          calorie_target_min: number | null
          cardio_type: string
          client_id: string
          client_notes: string | null
          created_at: string
          custom_day_type: string | null
          custom_type: string | null
          day_type: string
          duration_minutes: number | null
          enabled: boolean
          end_date: string | null
          ending_soon_days: number
          frequency_per_week: number | null
          goal: string | null
          heart_rate_zone: string | null
          id: string
          intensity: string | null
          last_updated_at: string
          machine_preference: string | null
          phase_id: string | null
          program_name: string | null
          show_calories_to_client: boolean
          start_date: string
          status: string
          step_target: number | null
          updated_at: string
          visible_to_client: boolean
        }
        Insert: {
          admin_notes?: string | null
          calorie_target_max?: number | null
          calorie_target_min?: number | null
          cardio_type?: string
          client_id: string
          client_notes?: string | null
          created_at?: string
          custom_day_type?: string | null
          custom_type?: string | null
          day_type?: string
          duration_minutes?: number | null
          enabled?: boolean
          end_date?: string | null
          ending_soon_days?: number
          frequency_per_week?: number | null
          goal?: string | null
          heart_rate_zone?: string | null
          id?: string
          intensity?: string | null
          last_updated_at?: string
          machine_preference?: string | null
          phase_id?: string | null
          program_name?: string | null
          show_calories_to_client?: boolean
          start_date: string
          status?: string
          step_target?: number | null
          updated_at?: string
          visible_to_client?: boolean
        }
        Update: {
          admin_notes?: string | null
          calorie_target_max?: number | null
          calorie_target_min?: number | null
          cardio_type?: string
          client_id?: string
          client_notes?: string | null
          created_at?: string
          custom_day_type?: string | null
          custom_type?: string | null
          day_type?: string
          duration_minutes?: number | null
          enabled?: boolean
          end_date?: string | null
          ending_soon_days?: number
          frequency_per_week?: number | null
          goal?: string | null
          heart_rate_zone?: string | null
          id?: string
          intensity?: string | null
          last_updated_at?: string
          machine_preference?: string | null
          phase_id?: string | null
          program_name?: string | null
          show_calories_to_client?: boolean
          start_date?: string
          status?: string
          step_target?: number | null
          updated_at?: string
          visible_to_client?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "cardio_targets_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_gif_favorites: {
        Row: {
          created_at: string
          gif_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          gif_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          gif_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_gif_favorites_gif_id_fkey"
            columns: ["gif_id"]
            isOneToOne: false
            referencedRelation: "chat_gifs"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_gif_recent: {
        Row: {
          gif_id: string
          used_at: string
          user_id: string
        }
        Insert: {
          gif_id: string
          used_at?: string
          user_id: string
        }
        Update: {
          gif_id?: string
          used_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_gif_recent_gif_id_fkey"
            columns: ["gif_id"]
            isOneToOne: false
            referencedRelation: "chat_gifs"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_gifs: {
        Row: {
          active: boolean
          archived: boolean
          category: string
          created_at: string
          created_by: string | null
          id: string
          is_featured: boolean
          media_type: string
          media_url: string
          sort_order: number
          tags: string[]
          thumb_url: string | null
          title: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          archived?: boolean
          category: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_featured?: boolean
          media_type?: string
          media_url: string
          sort_order?: number
          tags?: string[]
          thumb_url?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          archived?: boolean
          category?: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_featured?: boolean
          media_type?: string
          media_url?: string
          sort_order?: number
          tags?: string[]
          thumb_url?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      chat_group_members: {
        Row: {
          added_at: string
          added_by: string | null
          group_id: string
          last_read_at: string | null
          role: Database["public"]["Enums"]["group_member_role"]
          user_id: string
        }
        Insert: {
          added_at?: string
          added_by?: string | null
          group_id: string
          last_read_at?: string | null
          role?: Database["public"]["Enums"]["group_member_role"]
          user_id: string
        }
        Update: {
          added_at?: string
          added_by?: string | null
          group_id?: string
          last_read_at?: string | null
          role?: Database["public"]["Enums"]["group_member_role"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_group_members_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "chat_groups"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_groups: {
        Row: {
          archived: boolean
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          name: string
          permission_mode: Database["public"]["Enums"]["group_permission_mode"]
          updated_at: string
        }
        Insert: {
          archived?: boolean
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          name: string
          permission_mode?: Database["public"]["Enums"]["group_permission_mode"]
          updated_at?: string
        }
        Update: {
          archived?: boolean
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          name?: string
          permission_mode?: Database["public"]["Enums"]["group_permission_mode"]
          updated_at?: string
        }
        Relationships: []
      }
      chat_sound_favorites: {
        Row: {
          created_at: string
          sound_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          sound_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          sound_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_sound_favorites_sound_id_fkey"
            columns: ["sound_id"]
            isOneToOne: false
            referencedRelation: "chat_sounds"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_sound_recent: {
        Row: {
          sound_id: string
          used_at: string
          user_id: string
        }
        Insert: {
          sound_id: string
          used_at?: string
          user_id: string
        }
        Update: {
          sound_id?: string
          used_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_sound_recent_sound_id_fkey"
            columns: ["sound_id"]
            isOneToOne: false
            referencedRelation: "chat_sounds"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_sounds: {
        Row: {
          active: boolean
          archived: boolean
          category: string
          created_at: string
          created_text: string | null
          duration_ms: number | null
          id: string
          is_featured: boolean
          media_url: string
          mime: string
          sort_order: number
          tags: string[]
          title: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          archived?: boolean
          category?: string
          created_at?: string
          created_text?: string | null
          duration_ms?: number | null
          id?: string
          is_featured?: boolean
          media_url: string
          mime?: string
          sort_order?: number
          tags?: string[]
          title: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          archived?: boolean
          category?: string
          created_at?: string
          created_text?: string | null
          duration_ms?: number | null
          id?: string
          is_featured?: boolean
          media_url?: string
          mime?: string
          sort_order?: number
          tags?: string[]
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      check_in_links: {
        Row: {
          active: boolean
          archived: boolean
          archived_at: string | null
          archived_by: string | null
          check_in_type: string
          created_at: string
          created_by: string | null
          custom_type: string | null
          description: string | null
          due_day: string | null
          frequency: string
          id: string
          notes_admin: string | null
          notes_client: string | null
          require_photos: boolean
          require_video: boolean
          title: string
          updated_at: string
          url: string
          visible_to_client: boolean
        }
        Insert: {
          active?: boolean
          archived?: boolean
          archived_at?: string | null
          archived_by?: string | null
          check_in_type?: string
          created_at?: string
          created_by?: string | null
          custom_type?: string | null
          description?: string | null
          due_day?: string | null
          frequency?: string
          id?: string
          notes_admin?: string | null
          notes_client?: string | null
          require_photos?: boolean
          require_video?: boolean
          title: string
          updated_at?: string
          url: string
          visible_to_client?: boolean
        }
        Update: {
          active?: boolean
          archived?: boolean
          archived_at?: string | null
          archived_by?: string | null
          check_in_type?: string
          created_at?: string
          created_by?: string | null
          custom_type?: string | null
          description?: string | null
          due_day?: string | null
          frequency?: string
          id?: string
          notes_admin?: string | null
          notes_client?: string | null
          require_photos?: boolean
          require_video?: boolean
          title?: string
          updated_at?: string
          url?: string
          visible_to_client?: boolean
        }
        Relationships: []
      }
      client_action_requests: {
        Row: {
          client_id: string
          coach_user_id: string
          completed_at: string | null
          created_at: string
          dismissed_at: string | null
          due_date: string | null
          external_form_url: string | null
          file_mime: string | null
          file_name: string | null
          file_path: string | null
          id: string
          internal_notes: string | null
          link_label: string | null
          link_url: string | null
          message: string
          native_form_id: string | null
          notify_client: boolean
          priority: string | null
          seen_at: string | null
          title: string
          updated_at: string
        }
        Insert: {
          client_id: string
          coach_user_id: string
          completed_at?: string | null
          created_at?: string
          dismissed_at?: string | null
          due_date?: string | null
          external_form_url?: string | null
          file_mime?: string | null
          file_name?: string | null
          file_path?: string | null
          id?: string
          internal_notes?: string | null
          link_label?: string | null
          link_url?: string | null
          message: string
          native_form_id?: string | null
          notify_client?: boolean
          priority?: string | null
          seen_at?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          client_id?: string
          coach_user_id?: string
          completed_at?: string | null
          created_at?: string
          dismissed_at?: string | null
          due_date?: string | null
          external_form_url?: string | null
          file_mime?: string | null
          file_name?: string | null
          file_path?: string | null
          id?: string
          internal_notes?: string | null
          link_label?: string | null
          link_url?: string | null
          message?: string
          native_form_id?: string | null
          notify_client?: boolean
          priority?: string | null
          seen_at?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_action_requests_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_action_requests_native_form_id_fkey"
            columns: ["native_form_id"]
            isOneToOne: false
            referencedRelation: "nf_forms"
            referencedColumns: ["id"]
          },
        ]
      }
      client_activity_log: {
        Row: {
          action: string
          actor_role: string
          actor_user_id: string | null
          client_id: string
          created_at: string
          details: Json
          id: string
        }
        Insert: {
          action: string
          actor_role: string
          actor_user_id?: string | null
          client_id: string
          created_at?: string
          details?: Json
          id?: string
        }
        Update: {
          action?: string
          actor_role?: string
          actor_user_id?: string | null
          client_id?: string
          created_at?: string
          details?: Json
          id?: string
        }
        Relationships: []
      }
      client_birthday_card_views: {
        Row: {
          birthday_year: number
          client_id: string
          created_at: string
          dismissed_at: string | null
          id: string
          seen_at: string
        }
        Insert: {
          birthday_year: number
          client_id: string
          created_at?: string
          dismissed_at?: string | null
          id?: string
          seen_at?: string
        }
        Update: {
          birthday_year?: number
          client_id?: string
          created_at?: string
          dismissed_at?: string | null
          id?: string
          seen_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_birthday_card_views_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      client_birthday_cards: {
        Row: {
          celebration_effect: boolean
          client_id: string
          coach_message: string | null
          created_at: string
          enabled: boolean
          headline: string | null
          id: string
          message: string | null
          quote: string | null
          show_message_coach_button: boolean
          template_key: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          celebration_effect?: boolean
          client_id: string
          coach_message?: string | null
          created_at?: string
          enabled?: boolean
          headline?: string | null
          id?: string
          message?: string | null
          quote?: string | null
          show_message_coach_button?: boolean
          template_key?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          celebration_effect?: boolean
          client_id?: string
          coach_message?: string | null
          created_at?: string
          enabled?: boolean
          headline?: string | null
          id?: string
          message?: string | null
          quote?: string | null
          show_message_coach_button?: boolean
          template_key?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "client_birthday_cards_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: true
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      client_birthday_wishes: {
        Row: {
          birthday_year: number
          client_id: string
          created_at: string
          id: string
          wished_at: string
          wished_by: string | null
        }
        Insert: {
          birthday_year: number
          client_id: string
          created_at?: string
          id?: string
          wished_at?: string
          wished_by?: string | null
        }
        Update: {
          birthday_year?: number
          client_id?: string
          created_at?: string
          id?: string
          wished_at?: string
          wished_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "client_birthday_wishes_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      client_compliance_settings: {
        Row: {
          bodyweight_expected: boolean
          bodyweight_frequency_per_week: number | null
          check_in_due_day: string | null
          check_in_required: boolean
          client_id: string
          created_at: string
          followup_threshold_days: number
          id: string
          inactivity_threshold_days: number
          lift_video_frequency_per_week: number | null
          lift_videos_expected: boolean
          message_response_expected_days: number | null
          noncompliant_threshold_days: number
          notes: string | null
          progress_photos_expected: boolean
          updated_at: string
        }
        Insert: {
          bodyweight_expected?: boolean
          bodyweight_frequency_per_week?: number | null
          check_in_due_day?: string | null
          check_in_required?: boolean
          client_id: string
          created_at?: string
          followup_threshold_days?: number
          id?: string
          inactivity_threshold_days?: number
          lift_video_frequency_per_week?: number | null
          lift_videos_expected?: boolean
          message_response_expected_days?: number | null
          noncompliant_threshold_days?: number
          notes?: string | null
          progress_photos_expected?: boolean
          updated_at?: string
        }
        Update: {
          bodyweight_expected?: boolean
          bodyweight_frequency_per_week?: number | null
          check_in_due_day?: string | null
          check_in_required?: boolean
          client_id?: string
          created_at?: string
          followup_threshold_days?: number
          id?: string
          inactivity_threshold_days?: number
          lift_video_frequency_per_week?: number | null
          lift_videos_expected?: boolean
          message_response_expected_days?: number | null
          noncompliant_threshold_days?: number
          notes?: string | null
          progress_photos_expected?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      client_drive_folders: {
        Row: {
          client_id: string
          created_at: string
          folder_id: string | null
          folder_name: string | null
          folder_url: string | null
          id: string
          last_error: string | null
          status: string
          subfolders: Json
          updated_at: string
        }
        Insert: {
          client_id: string
          created_at?: string
          folder_id?: string | null
          folder_name?: string | null
          folder_url?: string | null
          id?: string
          last_error?: string | null
          status?: string
          subfolders?: Json
          updated_at?: string
        }
        Update: {
          client_id?: string
          created_at?: string
          folder_id?: string | null
          folder_name?: string | null
          folder_url?: string | null
          id?: string
          last_error?: string | null
          status?: string
          subfolders?: Json
          updated_at?: string
        }
        Relationships: []
      }
      client_quick_links: {
        Row: {
          archived: boolean
          archived_at: string | null
          archived_by: string | null
          client_id: string
          created_at: string
          created_by: string | null
          id: string
          link_type: string
          notes: string | null
          sort_order: number
          status: string
          title: string
          updated_at: string
          url: string
          visibility: string
        }
        Insert: {
          archived?: boolean
          archived_at?: string | null
          archived_by?: string | null
          client_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          link_type?: string
          notes?: string | null
          sort_order?: number
          status?: string
          title: string
          updated_at?: string
          url: string
          visibility?: string
        }
        Update: {
          archived?: boolean
          archived_at?: string | null
          archived_by?: string | null
          client_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          link_type?: string
          notes?: string | null
          sort_order?: number
          status?: string
          title?: string
          updated_at?: string
          url?: string
          visibility?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_quick_links_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      clients: {
        Row: {
          account_created_at: string | null
          account_status: string
          address: string | null
          agreement_link: string | null
          agreement_signature_platform_link: string | null
          agreement_signed: boolean
          agreement_signed_date: string | null
          agreement_status: string
          agreement_version: string | null
          allow_phone_calls: boolean | null
          archived: boolean
          archived_at: string | null
          archived_by: string | null
          assigned_check_in_link_id: string | null
          assigned_coach_id: string | null
          available_training_days: string[] | null
          basic_info_completed_at: string | null
          basic_info_update_reason: string | null
          basic_info_update_requested: boolean
          basic_info_update_requested_at: string | null
          bodyweight_goal_set_at: string | null
          bodyweight_goal_type: string | null
          bodyweight_goal_unit: string | null
          bodyweight_goal_value: number | null
          bodyweight_goal_value_max: number | null
          calendar_link: string | null
          call_access_enabled: boolean
          checkin_allow_photos: boolean
          checkin_allow_video: boolean
          checkin_due_day: string | null
          checkin_form_link: string | null
          checkin_instructions: string | null
          checkin_link_updated_at: string | null
          checkin_notes_admin: string | null
          checkin_notes_client: string | null
          city: string | null
          coach_call_access_enabled: boolean
          coach_notes: string | null
          coach_sms_access_enabled: boolean
          coaching_package: string | null
          coaching_type: string | null
          committed_training_days: string[] | null
          committed_training_frequency: number | null
          compliance_status: string
          compliance_status_reasons: Json
          compliance_status_updated_at: string | null
          compliance_tracking_enabled: boolean
          country: string | null
          created_at: string
          date_of_birth: string | null
          deactivated_at: string | null
          deactivated_by: string | null
          deactivation_note: string | null
          deactivation_reason: string | null
          default_session_location: string | null
          drive_folder_link: string | null
          email: string | null
          emergency_contact_name: string | null
          emergency_contact_phone: string | null
          facebook: string | null
          first_name: string | null
          full_name: string
          goals: string | null
          height_cm: number | null
          home_screen_setup_completed_at: string | null
          home_screen_setup_remind_after: string | null
          home_screen_setup_status: string
          id: string
          info_last_updated_at: string | null
          info_last_updated_by: string | null
          info_last_updated_fields: string[] | null
          info_update_requested: boolean
          info_update_requested_at: string | null
          injuries: string | null
          instagram: string | null
          invite_expires_at: string | null
          invite_last_resent_at: string | null
          invite_sent_at: string | null
          is_powerlifter: boolean
          last_active_at: string | null
          last_active_route: string | null
          last_name: string | null
          last_program_update: string | null
          last_signed_in_at: string | null
          lifestyle_notes: string | null
          linkedin: string | null
          needs_admin_help: boolean
          next_program_update: string | null
          nutrition_notes: string | null
          onboarded_by_coach_id: string | null
          openpowerlifting_url: string | null
          other_social_handle: string | null
          other_social_label: string | null
          package_tracking_enabled: boolean
          password_reset_sent_at: string | null
          payment_status: string | null
          phone: string | null
          portal_access_disabled: boolean
          postal_code: string | null
          powerlifter_badge_label: string
          powerlifting_visible_to_client: boolean
          preferred_height_unit: string
          preferred_high_days: string[]
          preferred_name: string | null
          preferred_rest_days: string[]
          preferred_training_days: string[]
          preferred_training_time: string | null
          preferred_weight_unit: string
          profile_picture_needs_update: boolean
          profile_picture_needs_update_at: string | null
          profile_picture_needs_update_reason: string | null
          profile_picture_source: string | null
          profile_picture_updated_at: string | null
          profile_picture_updated_by: string | null
          profile_picture_url: string | null
          program_phase: string | null
          program_sheet_link: string | null
          province: string | null
          renewal_date: string | null
          schedule_changes_weekly: boolean | null
          schedule_notes: string | null
          schedule_updated_at: string | null
          sessions_purchased: number
          sessions_used: number
          sms_opt_out: boolean
          start_date: string | null
          status: string
          stripe_customer_id: string | null
          stripe_link: string | null
          tags: string[]
          tiktok: string | null
          timezone: string
          timezone_confirmed_at: string | null
          training_notes: string | null
          training_schedule_completed: boolean
          training_schedule_last_updated: string | null
          training_schedule_updated_by: string | null
          twitter_x: string | null
          unavailable_training_days: string[] | null
          updated_at: string
          user_id: string | null
          warmup_protocol_id: string | null
          website: string | null
          youtube: string | null
        }
        Insert: {
          account_created_at?: string | null
          account_status?: string
          address?: string | null
          agreement_link?: string | null
          agreement_signature_platform_link?: string | null
          agreement_signed?: boolean
          agreement_signed_date?: string | null
          agreement_status?: string
          agreement_version?: string | null
          allow_phone_calls?: boolean | null
          archived?: boolean
          archived_at?: string | null
          archived_by?: string | null
          assigned_check_in_link_id?: string | null
          assigned_coach_id?: string | null
          available_training_days?: string[] | null
          basic_info_completed_at?: string | null
          basic_info_update_reason?: string | null
          basic_info_update_requested?: boolean
          basic_info_update_requested_at?: string | null
          bodyweight_goal_set_at?: string | null
          bodyweight_goal_type?: string | null
          bodyweight_goal_unit?: string | null
          bodyweight_goal_value?: number | null
          bodyweight_goal_value_max?: number | null
          calendar_link?: string | null
          call_access_enabled?: boolean
          checkin_allow_photos?: boolean
          checkin_allow_video?: boolean
          checkin_due_day?: string | null
          checkin_form_link?: string | null
          checkin_instructions?: string | null
          checkin_link_updated_at?: string | null
          checkin_notes_admin?: string | null
          checkin_notes_client?: string | null
          city?: string | null
          coach_call_access_enabled?: boolean
          coach_notes?: string | null
          coach_sms_access_enabled?: boolean
          coaching_package?: string | null
          coaching_type?: string | null
          committed_training_days?: string[] | null
          committed_training_frequency?: number | null
          compliance_status?: string
          compliance_status_reasons?: Json
          compliance_status_updated_at?: string | null
          compliance_tracking_enabled?: boolean
          country?: string | null
          created_at?: string
          date_of_birth?: string | null
          deactivated_at?: string | null
          deactivated_by?: string | null
          deactivation_note?: string | null
          deactivation_reason?: string | null
          default_session_location?: string | null
          drive_folder_link?: string | null
          email?: string | null
          emergency_contact_name?: string | null
          emergency_contact_phone?: string | null
          facebook?: string | null
          first_name?: string | null
          full_name: string
          goals?: string | null
          height_cm?: number | null
          home_screen_setup_completed_at?: string | null
          home_screen_setup_remind_after?: string | null
          home_screen_setup_status?: string
          id?: string
          info_last_updated_at?: string | null
          info_last_updated_by?: string | null
          info_last_updated_fields?: string[] | null
          info_update_requested?: boolean
          info_update_requested_at?: string | null
          injuries?: string | null
          instagram?: string | null
          invite_expires_at?: string | null
          invite_last_resent_at?: string | null
          invite_sent_at?: string | null
          is_powerlifter?: boolean
          last_active_at?: string | null
          last_active_route?: string | null
          last_name?: string | null
          last_program_update?: string | null
          last_signed_in_at?: string | null
          lifestyle_notes?: string | null
          linkedin?: string | null
          needs_admin_help?: boolean
          next_program_update?: string | null
          nutrition_notes?: string | null
          onboarded_by_coach_id?: string | null
          openpowerlifting_url?: string | null
          other_social_handle?: string | null
          other_social_label?: string | null
          package_tracking_enabled?: boolean
          password_reset_sent_at?: string | null
          payment_status?: string | null
          phone?: string | null
          portal_access_disabled?: boolean
          postal_code?: string | null
          powerlifter_badge_label?: string
          powerlifting_visible_to_client?: boolean
          preferred_height_unit?: string
          preferred_high_days?: string[]
          preferred_name?: string | null
          preferred_rest_days?: string[]
          preferred_training_days?: string[]
          preferred_training_time?: string | null
          preferred_weight_unit?: string
          profile_picture_needs_update?: boolean
          profile_picture_needs_update_at?: string | null
          profile_picture_needs_update_reason?: string | null
          profile_picture_source?: string | null
          profile_picture_updated_at?: string | null
          profile_picture_updated_by?: string | null
          profile_picture_url?: string | null
          program_phase?: string | null
          program_sheet_link?: string | null
          province?: string | null
          renewal_date?: string | null
          schedule_changes_weekly?: boolean | null
          schedule_notes?: string | null
          schedule_updated_at?: string | null
          sessions_purchased?: number
          sessions_used?: number
          sms_opt_out?: boolean
          start_date?: string | null
          status?: string
          stripe_customer_id?: string | null
          stripe_link?: string | null
          tags?: string[]
          tiktok?: string | null
          timezone?: string
          timezone_confirmed_at?: string | null
          training_notes?: string | null
          training_schedule_completed?: boolean
          training_schedule_last_updated?: string | null
          training_schedule_updated_by?: string | null
          twitter_x?: string | null
          unavailable_training_days?: string[] | null
          updated_at?: string
          user_id?: string | null
          warmup_protocol_id?: string | null
          website?: string | null
          youtube?: string | null
        }
        Update: {
          account_created_at?: string | null
          account_status?: string
          address?: string | null
          agreement_link?: string | null
          agreement_signature_platform_link?: string | null
          agreement_signed?: boolean
          agreement_signed_date?: string | null
          agreement_status?: string
          agreement_version?: string | null
          allow_phone_calls?: boolean | null
          archived?: boolean
          archived_at?: string | null
          archived_by?: string | null
          assigned_check_in_link_id?: string | null
          assigned_coach_id?: string | null
          available_training_days?: string[] | null
          basic_info_completed_at?: string | null
          basic_info_update_reason?: string | null
          basic_info_update_requested?: boolean
          basic_info_update_requested_at?: string | null
          bodyweight_goal_set_at?: string | null
          bodyweight_goal_type?: string | null
          bodyweight_goal_unit?: string | null
          bodyweight_goal_value?: number | null
          bodyweight_goal_value_max?: number | null
          calendar_link?: string | null
          call_access_enabled?: boolean
          checkin_allow_photos?: boolean
          checkin_allow_video?: boolean
          checkin_due_day?: string | null
          checkin_form_link?: string | null
          checkin_instructions?: string | null
          checkin_link_updated_at?: string | null
          checkin_notes_admin?: string | null
          checkin_notes_client?: string | null
          city?: string | null
          coach_call_access_enabled?: boolean
          coach_notes?: string | null
          coach_sms_access_enabled?: boolean
          coaching_package?: string | null
          coaching_type?: string | null
          committed_training_days?: string[] | null
          committed_training_frequency?: number | null
          compliance_status?: string
          compliance_status_reasons?: Json
          compliance_status_updated_at?: string | null
          compliance_tracking_enabled?: boolean
          country?: string | null
          created_at?: string
          date_of_birth?: string | null
          deactivated_at?: string | null
          deactivated_by?: string | null
          deactivation_note?: string | null
          deactivation_reason?: string | null
          default_session_location?: string | null
          drive_folder_link?: string | null
          email?: string | null
          emergency_contact_name?: string | null
          emergency_contact_phone?: string | null
          facebook?: string | null
          first_name?: string | null
          full_name?: string
          goals?: string | null
          height_cm?: number | null
          home_screen_setup_completed_at?: string | null
          home_screen_setup_remind_after?: string | null
          home_screen_setup_status?: string
          id?: string
          info_last_updated_at?: string | null
          info_last_updated_by?: string | null
          info_last_updated_fields?: string[] | null
          info_update_requested?: boolean
          info_update_requested_at?: string | null
          injuries?: string | null
          instagram?: string | null
          invite_expires_at?: string | null
          invite_last_resent_at?: string | null
          invite_sent_at?: string | null
          is_powerlifter?: boolean
          last_active_at?: string | null
          last_active_route?: string | null
          last_name?: string | null
          last_program_update?: string | null
          last_signed_in_at?: string | null
          lifestyle_notes?: string | null
          linkedin?: string | null
          needs_admin_help?: boolean
          next_program_update?: string | null
          nutrition_notes?: string | null
          onboarded_by_coach_id?: string | null
          openpowerlifting_url?: string | null
          other_social_handle?: string | null
          other_social_label?: string | null
          package_tracking_enabled?: boolean
          password_reset_sent_at?: string | null
          payment_status?: string | null
          phone?: string | null
          portal_access_disabled?: boolean
          postal_code?: string | null
          powerlifter_badge_label?: string
          powerlifting_visible_to_client?: boolean
          preferred_height_unit?: string
          preferred_high_days?: string[]
          preferred_name?: string | null
          preferred_rest_days?: string[]
          preferred_training_days?: string[]
          preferred_training_time?: string | null
          preferred_weight_unit?: string
          profile_picture_needs_update?: boolean
          profile_picture_needs_update_at?: string | null
          profile_picture_needs_update_reason?: string | null
          profile_picture_source?: string | null
          profile_picture_updated_at?: string | null
          profile_picture_updated_by?: string | null
          profile_picture_url?: string | null
          program_phase?: string | null
          program_sheet_link?: string | null
          province?: string | null
          renewal_date?: string | null
          schedule_changes_weekly?: boolean | null
          schedule_notes?: string | null
          schedule_updated_at?: string | null
          sessions_purchased?: number
          sessions_used?: number
          sms_opt_out?: boolean
          start_date?: string | null
          status?: string
          stripe_customer_id?: string | null
          stripe_link?: string | null
          tags?: string[]
          tiktok?: string | null
          timezone?: string
          timezone_confirmed_at?: string | null
          training_notes?: string | null
          training_schedule_completed?: boolean
          training_schedule_last_updated?: string | null
          training_schedule_updated_by?: string | null
          twitter_x?: string | null
          unavailable_training_days?: string[] | null
          updated_at?: string
          user_id?: string | null
          warmup_protocol_id?: string | null
          website?: string | null
          youtube?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "clients_assigned_check_in_link_id_fkey"
            columns: ["assigned_check_in_link_id"]
            isOneToOne: false
            referencedRelation: "check_in_links"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clients_warmup_protocol_id_fkey"
            columns: ["warmup_protocol_id"]
            isOneToOne: false
            referencedRelation: "warmup_protocols"
            referencedColumns: ["id"]
          },
        ]
      }
      coach_faqs: {
        Row: {
          active: boolean
          answer: string
          category: string
          created_at: string
          created_by: string | null
          examples: string | null
          id: string
          question: string
          sort_order: number
          subcategory: string | null
          updated_at: string
          visible_coaching: boolean
          visible_everyone: boolean
          visible_membership: boolean
        }
        Insert: {
          active?: boolean
          answer: string
          category: string
          created_at?: string
          created_by?: string | null
          examples?: string | null
          id?: string
          question: string
          sort_order?: number
          subcategory?: string | null
          updated_at?: string
          visible_coaching?: boolean
          visible_everyone?: boolean
          visible_membership?: boolean
        }
        Update: {
          active?: boolean
          answer?: string
          category?: string
          created_at?: string
          created_by?: string | null
          examples?: string | null
          id?: string
          question?: string
          sort_order?: number
          subcategory?: string | null
          updated_at?: string
          visible_coaching?: boolean
          visible_everyone?: boolean
          visible_membership?: boolean
        }
        Relationships: []
      }
      coach_followups: {
        Row: {
          client_id: string
          completed_at: string | null
          created_at: string
          created_by: string | null
          due_date: string | null
          id: string
          notes: string | null
          reason: string
          source: string | null
          status: string
          updated_at: string
        }
        Insert: {
          client_id: string
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          due_date?: string | null
          id?: string
          notes?: string | null
          reason: string
          source?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          client_id?: string
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          due_date?: string | null
          id?: string
          notes?: string | null
          reason?: string
          source?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "coach_followups_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      coach_intel_reviews: {
        Row: {
          alert_key: string
          alert_kind: string
          client_id: string
          id: string
          note: string | null
          reviewed_at: string
          reviewed_by: string | null
        }
        Insert: {
          alert_key: string
          alert_kind: string
          client_id: string
          id?: string
          note?: string | null
          reviewed_at?: string
          reviewed_by?: string | null
        }
        Update: {
          alert_key?: string
          alert_kind?: string
          client_id?: string
          id?: string
          note?: string | null
          reviewed_at?: string
          reviewed_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "coach_intel_reviews_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      coach_invites: {
        Row: {
          accepted_at: string | null
          coach_id: string
          created_at: string
          created_by: string | null
          email: string
          expires_at: string
          id: string
          token: string
        }
        Insert: {
          accepted_at?: string | null
          coach_id: string
          created_at?: string
          created_by?: string | null
          email: string
          expires_at?: string
          id?: string
          token: string
        }
        Update: {
          accepted_at?: string | null
          coach_id?: string
          created_at?: string
          created_by?: string | null
          email?: string
          expires_at?: string
          id?: string
          token?: string
        }
        Relationships: []
      }
      coach_pain_flags: {
        Row: {
          client_id: string
          created_at: string
          day_title: string | null
          exercise: string | null
          id: string
          matched_keywords: string[]
          note_date: string | null
          note_text: string
          source: string
          source_id: string
          status: string
          status_note: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          client_id: string
          created_at?: string
          day_title?: string | null
          exercise?: string | null
          id?: string
          matched_keywords?: string[]
          note_date?: string | null
          note_text: string
          source: string
          source_id: string
          status?: string
          status_note?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          client_id?: string
          created_at?: string
          day_title?: string | null
          exercise?: string | null
          id?: string
          matched_keywords?: string[]
          note_date?: string | null
          note_text?: string
          source?: string
          source_id?: string
          status?: string
          status_note?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "coach_pain_flags_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      coaches: {
        Row: {
          archived: boolean
          archived_at: string | null
          archived_by: string | null
          created_at: string
          email: string
          first_name: string | null
          full_name: string
          id: string
          last_login_at: string | null
          last_name: string | null
          notes: string | null
          phone: string | null
          profile_picture_url: string | null
          start_date: string | null
          status: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          archived?: boolean
          archived_at?: string | null
          archived_by?: string | null
          created_at?: string
          email: string
          first_name?: string | null
          full_name: string
          id?: string
          last_login_at?: string | null
          last_name?: string | null
          notes?: string | null
          phone?: string | null
          profile_picture_url?: string | null
          start_date?: string | null
          status?: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          archived?: boolean
          archived_at?: string | null
          archived_by?: string | null
          created_at?: string
          email?: string
          first_name?: string | null
          full_name?: string
          id?: string
          last_login_at?: string | null
          last_name?: string | null
          notes?: string | null
          phone?: string | null
          profile_picture_url?: string | null
          start_date?: string | null
          status?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: []
      }
      coaching_applications: {
        Row: {
          budget_range: string | null
          created_at: string
          email: string
          full_name: string
          goals: string | null
          id: string
          notes_admin: string | null
          phone: string | null
          schedule: string | null
          source: string
          status: string
          timeline: string | null
          training_history: string | null
          updated_at: string
        }
        Insert: {
          budget_range?: string | null
          created_at?: string
          email: string
          full_name: string
          goals?: string | null
          id?: string
          notes_admin?: string | null
          phone?: string | null
          schedule?: string | null
          source?: string
          status?: string
          timeline?: string | null
          training_history?: string | null
          updated_at?: string
        }
        Update: {
          budget_range?: string | null
          created_at?: string
          email?: string
          full_name?: string
          goals?: string | null
          id?: string
          notes_admin?: string | null
          phone?: string | null
          schedule?: string | null
          source?: string
          status?: string
          timeline?: string | null
          training_history?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      coaching_products: {
        Row: {
          active: boolean
          agreement_before_service: boolean
          agreement_required: boolean
          agreement_template_id: string | null
          archived: boolean
          archived_at: string | null
          archived_by: string | null
          created_at: string
          created_by: string | null
          currency: string
          description: string | null
          details: string | null
          id: string
          image_url: string | null
          included_features: string[]
          is_member_facing: boolean
          member_tier_label: string | null
          mode: string
          name: string
          notes: string | null
          offer_id: string | null
          payment_link_url: string | null
          payment_structure: string | null
          price_cents: number
          product_type: string | null
          status: string
          stripe_payment_link_id: string | null
          stripe_price_id: string | null
          stripe_product_id: string | null
          term_length: number | null
          term_unit: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          agreement_before_service?: boolean
          agreement_required?: boolean
          agreement_template_id?: string | null
          archived?: boolean
          archived_at?: string | null
          archived_by?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          description?: string | null
          details?: string | null
          id?: string
          image_url?: string | null
          included_features?: string[]
          is_member_facing?: boolean
          member_tier_label?: string | null
          mode?: string
          name: string
          notes?: string | null
          offer_id?: string | null
          payment_link_url?: string | null
          payment_structure?: string | null
          price_cents: number
          product_type?: string | null
          status?: string
          stripe_payment_link_id?: string | null
          stripe_price_id?: string | null
          stripe_product_id?: string | null
          term_length?: number | null
          term_unit?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          agreement_before_service?: boolean
          agreement_required?: boolean
          agreement_template_id?: string | null
          archived?: boolean
          archived_at?: string | null
          archived_by?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          description?: string | null
          details?: string | null
          id?: string
          image_url?: string | null
          included_features?: string[]
          is_member_facing?: boolean
          member_tier_label?: string | null
          mode?: string
          name?: string
          notes?: string | null
          offer_id?: string | null
          payment_link_url?: string | null
          payment_structure?: string | null
          price_cents?: number
          product_type?: string | null
          status?: string
          stripe_payment_link_id?: string | null
          stripe_price_id?: string | null
          stripe_product_id?: string | null
          term_length?: number | null
          term_unit?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "coaching_products_offer_id_fkey"
            columns: ["offer_id"]
            isOneToOne: false
            referencedRelation: "offers"
            referencedColumns: ["id"]
          },
        ]
      }
      communication_log: {
        Row: {
          client_id: string
          comm_type: string | null
          created_at: string
          date: string
          follow_up_needed: boolean | null
          id: string
          priority: string | null
          summary: string | null
        }
        Insert: {
          client_id: string
          comm_type?: string | null
          created_at?: string
          date?: string
          follow_up_needed?: boolean | null
          id?: string
          priority?: string | null
          summary?: string | null
        }
        Update: {
          client_id?: string
          comm_type?: string | null
          created_at?: string
          date?: string
          follow_up_needed?: boolean | null
          id?: string
          priority?: string | null
          summary?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "communication_log_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      conversation_state: {
        Row: {
          admin_last_read_at: string | null
          client_id: string
          client_last_read_at: string | null
          created_at: string
          last_message_at: string | null
          priority: string
          status: string
          updated_at: string
        }
        Insert: {
          admin_last_read_at?: string | null
          client_id: string
          client_last_read_at?: string | null
          created_at?: string
          last_message_at?: string | null
          priority?: string
          status?: string
          updated_at?: string
        }
        Update: {
          admin_last_read_at?: string | null
          client_id?: string
          client_last_read_at?: string | null
          created_at?: string
          last_message_at?: string | null
          priority?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversation_state_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: true
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      email_send_log: {
        Row: {
          created_at: string
          error_message: string | null
          id: string
          message_id: string | null
          metadata: Json | null
          recipient_email: string
          status: string
          template_name: string
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          id?: string
          message_id?: string | null
          metadata?: Json | null
          recipient_email: string
          status: string
          template_name: string
        }
        Update: {
          created_at?: string
          error_message?: string | null
          id?: string
          message_id?: string | null
          metadata?: Json | null
          recipient_email?: string
          status?: string
          template_name?: string
        }
        Relationships: []
      }
      email_send_state: {
        Row: {
          auth_email_ttl_minutes: number
          batch_size: number
          id: number
          retry_after_until: string | null
          send_delay_ms: number
          transactional_email_ttl_minutes: number
          updated_at: string
        }
        Insert: {
          auth_email_ttl_minutes?: number
          batch_size?: number
          id?: number
          retry_after_until?: string | null
          send_delay_ms?: number
          transactional_email_ttl_minutes?: number
          updated_at?: string
        }
        Update: {
          auth_email_ttl_minutes?: number
          batch_size?: number
          id?: number
          retry_after_until?: string | null
          send_delay_ms?: number
          transactional_email_ttl_minutes?: number
          updated_at?: string
        }
        Relationships: []
      }
      email_sender_settings: {
        Row: {
          created_at: string
          id: string
          last_test_at: string | null
          last_test_result: string | null
          notes: string | null
          provider: string
          reply_to_email: string
          sender_email: string
          sender_name: string
          singleton: boolean
          smtp_host: string | null
          smtp_port: number | null
          smtp_secure: boolean
          smtp_user: string | null
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          last_test_at?: string | null
          last_test_result?: string | null
          notes?: string | null
          provider?: string
          reply_to_email?: string
          sender_email?: string
          sender_name?: string
          singleton?: boolean
          smtp_host?: string | null
          smtp_port?: number | null
          smtp_secure?: boolean
          smtp_user?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          last_test_at?: string | null
          last_test_result?: string | null
          notes?: string | null
          provider?: string
          reply_to_email?: string
          sender_email?: string
          sender_name?: string
          singleton?: boolean
          smtp_host?: string | null
          smtp_port?: number | null
          smtp_secure?: boolean
          smtp_user?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      email_unsubscribe_tokens: {
        Row: {
          created_at: string
          email: string
          id: string
          token: string
          used_at: string | null
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          token: string
          used_at?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          token?: string
          used_at?: string | null
        }
        Relationships: []
      }
      event_assignments: {
        Row: {
          assigned_at: string
          assigned_by: string | null
          client_id: string
          event_id: string
          id: string
        }
        Insert: {
          assigned_at?: string
          assigned_by?: string | null
          client_id: string
          event_id: string
          id?: string
        }
        Update: {
          assigned_at?: string
          assigned_by?: string | null
          client_id?: string
          event_id?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_assignments_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_assignments_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      event_deadlines: {
        Row: {
          created_at: string
          due_date: string | null
          event_id: string
          id: string
          notes: string | null
          sort_order: number
          title: string
          updated_at: string
          visible_to_client: boolean
        }
        Insert: {
          created_at?: string
          due_date?: string | null
          event_id: string
          id?: string
          notes?: string | null
          sort_order?: number
          title: string
          updated_at?: string
          visible_to_client?: boolean
        }
        Update: {
          created_at?: string
          due_date?: string | null
          event_id?: string
          id?: string
          notes?: string | null
          sort_order?: number
          title?: string
          updated_at?: string
          visible_to_client?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "event_deadlines_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      event_format_prompts: {
        Row: {
          prompt: string
          updated_at: string
          user_id: string
        }
        Insert: {
          prompt: string
          updated_at?: string
          user_id: string
        }
        Update: {
          prompt?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      event_popup_acks: {
        Row: {
          acknowledged_at: string
          event_id: string
          id: string
          offset_key: Database["public"]["Enums"]["event_reminder_offset"]
          user_id: string
        }
        Insert: {
          acknowledged_at?: string
          event_id: string
          id?: string
          offset_key: Database["public"]["Enums"]["event_reminder_offset"]
          user_id: string
        }
        Update: {
          acknowledged_at?: string
          event_id?: string
          id?: string
          offset_key?: Database["public"]["Enums"]["event_reminder_offset"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_popup_acks_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      event_quick_links: {
        Row: {
          created_at: string
          event_id: string
          id: string
          internal_note: string | null
          link_type: Database["public"]["Enums"]["event_link_type"]
          sort_order: number
          title: string
          updated_at: string
          url: string
          visible_to_client: boolean
        }
        Insert: {
          created_at?: string
          event_id: string
          id?: string
          internal_note?: string | null
          link_type?: Database["public"]["Enums"]["event_link_type"]
          sort_order?: number
          title: string
          updated_at?: string
          url: string
          visible_to_client?: boolean
        }
        Update: {
          created_at?: string
          event_id?: string
          id?: string
          internal_note?: string | null
          link_type?: Database["public"]["Enums"]["event_link_type"]
          sort_order?: number
          title?: string
          updated_at?: string
          url?: string
          visible_to_client?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "event_quick_links_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      event_reminders: {
        Row: {
          created_at: string
          enabled: boolean
          event_id: string
          id: string
          last_fired_on: string | null
          message: string | null
          offset_key: Database["public"]["Enums"]["event_reminder_offset"]
          updated_at: string
          visible_to_client: boolean
        }
        Insert: {
          created_at?: string
          enabled?: boolean
          event_id: string
          id?: string
          last_fired_on?: string | null
          message?: string | null
          offset_key: Database["public"]["Enums"]["event_reminder_offset"]
          updated_at?: string
          visible_to_client?: boolean
        }
        Update: {
          created_at?: string
          enabled?: boolean
          event_id?: string
          id?: string
          last_fired_on?: string | null
          message?: string | null
          offset_key?: Database["public"]["Enums"]["event_reminder_offset"]
          updated_at?: string
          visible_to_client?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "event_reminders_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      events: {
        Row: {
          archived_at: string | null
          audience_scope: Database["public"]["Enums"]["event_audience_scope"]
          client_facing_notes: string | null
          completed_at: string | null
          created_at: string
          created_by: string | null
          description: string | null
          end_time: string | null
          event_date: string
          event_type: Database["public"]["Enums"]["event_type"]
          google_calendar_transparency: string
          google_event_id: string | null
          google_event_link: string | null
          google_sync_error: string | null
          google_synced_at: string | null
          id: string
          importance: Database["public"]["Enums"]["event_importance"]
          internal_notes: string | null
          location: string | null
          name: string
          review_notes: string | null
          review_status: Database["public"]["Enums"]["review_status"]
          reviewed_at: string | null
          reviewed_by: string | null
          start_time: string | null
          status: Database["public"]["Enums"]["event_status"]
          submitted_at: string | null
          submitted_by: string | null
          timezone: string | null
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          audience_scope?: Database["public"]["Enums"]["event_audience_scope"]
          client_facing_notes?: string | null
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          end_time?: string | null
          event_date: string
          event_type?: Database["public"]["Enums"]["event_type"]
          google_calendar_transparency?: string
          google_event_id?: string | null
          google_event_link?: string | null
          google_sync_error?: string | null
          google_synced_at?: string | null
          id?: string
          importance?: Database["public"]["Enums"]["event_importance"]
          internal_notes?: string | null
          location?: string | null
          name: string
          review_notes?: string | null
          review_status?: Database["public"]["Enums"]["review_status"]
          reviewed_at?: string | null
          reviewed_by?: string | null
          start_time?: string | null
          status?: Database["public"]["Enums"]["event_status"]
          submitted_at?: string | null
          submitted_by?: string | null
          timezone?: string | null
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          audience_scope?: Database["public"]["Enums"]["event_audience_scope"]
          client_facing_notes?: string | null
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          end_time?: string | null
          event_date?: string
          event_type?: Database["public"]["Enums"]["event_type"]
          google_calendar_transparency?: string
          google_event_id?: string | null
          google_event_link?: string | null
          google_sync_error?: string | null
          google_synced_at?: string | null
          id?: string
          importance?: Database["public"]["Enums"]["event_importance"]
          internal_notes?: string | null
          location?: string | null
          name?: string
          review_notes?: string | null
          review_status?: Database["public"]["Enums"]["review_status"]
          reviewed_at?: string | null
          reviewed_by?: string | null
          start_time?: string | null
          status?: Database["public"]["Enums"]["event_status"]
          submitted_at?: string | null
          submitted_by?: string | null
          timezone?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      exercises: {
        Row: {
          archived: boolean
          archived_at: string | null
          archived_by: string | null
          category: string | null
          common_mistakes: string | null
          created_at: string
          cues: string | null
          difficulty: string | null
          equipment: string | null
          id: string
          is_powerlifting: boolean
          legacy_youtube_url: string | null
          muscle_group: string | null
          name: string
          pl_lift_group: string | null
          quality_warning: string | null
          safe_to_publish: boolean
          source_quality: string | null
          source_type: string | null
          source_youtube_url: string | null
          tags: string[] | null
          thumbnail_url: string | null
          updated_at: string
          video_migration_status: string | null
          video_provider: string | null
          video_url: string | null
          vimeo_embed_url: string | null
          vimeo_url: string | null
          vimeo_video_id: string | null
          vimeo_working: boolean
          warmup_notes: string | null
          warmup_protocol_id: string | null
          youtube_fallback_allowed: boolean
          youtube_replaced: boolean
          youtube_url: string | null
        }
        Insert: {
          archived?: boolean
          archived_at?: string | null
          archived_by?: string | null
          category?: string | null
          common_mistakes?: string | null
          created_at?: string
          cues?: string | null
          difficulty?: string | null
          equipment?: string | null
          id?: string
          is_powerlifting?: boolean
          legacy_youtube_url?: string | null
          muscle_group?: string | null
          name: string
          pl_lift_group?: string | null
          quality_warning?: string | null
          safe_to_publish?: boolean
          source_quality?: string | null
          source_type?: string | null
          source_youtube_url?: string | null
          tags?: string[] | null
          thumbnail_url?: string | null
          updated_at?: string
          video_migration_status?: string | null
          video_provider?: string | null
          video_url?: string | null
          vimeo_embed_url?: string | null
          vimeo_url?: string | null
          vimeo_video_id?: string | null
          vimeo_working?: boolean
          warmup_notes?: string | null
          warmup_protocol_id?: string | null
          youtube_fallback_allowed?: boolean
          youtube_replaced?: boolean
          youtube_url?: string | null
        }
        Update: {
          archived?: boolean
          archived_at?: string | null
          archived_by?: string | null
          category?: string | null
          common_mistakes?: string | null
          created_at?: string
          cues?: string | null
          difficulty?: string | null
          equipment?: string | null
          id?: string
          is_powerlifting?: boolean
          legacy_youtube_url?: string | null
          muscle_group?: string | null
          name?: string
          pl_lift_group?: string | null
          quality_warning?: string | null
          safe_to_publish?: boolean
          source_quality?: string | null
          source_type?: string | null
          source_youtube_url?: string | null
          tags?: string[] | null
          thumbnail_url?: string | null
          updated_at?: string
          video_migration_status?: string | null
          video_provider?: string | null
          video_url?: string | null
          vimeo_embed_url?: string | null
          vimeo_url?: string | null
          vimeo_video_id?: string | null
          vimeo_working?: boolean
          warmup_notes?: string | null
          warmup_protocol_id?: string | null
          youtube_fallback_allowed?: boolean
          youtube_replaced?: boolean
          youtube_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "exercises_warmup_protocol_id_fkey"
            columns: ["warmup_protocol_id"]
            isOneToOne: false
            referencedRelation: "warmup_protocols"
            referencedColumns: ["id"]
          },
        ]
      }
      featured_member_items: {
        Row: {
          active: boolean
          created_at: string
          id: string
          item_type: string
          note: string | null
          plan_id: string | null
          position: number
          resource_id: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: string
          item_type: string
          note?: string | null
          plan_id?: string | null
          position?: number
          resource_id?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          item_type?: string
          note?: string | null
          plan_id?: string | null
          position?: number
          resource_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "featured_member_items_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: true
            referencedRelation: "member_plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "featured_member_items_resource_id_fkey"
            columns: ["resource_id"]
            isOneToOne: false
            referencedRelation: "member_resources"
            referencedColumns: ["id"]
          },
        ]
      }
      fillout_submissions: {
        Row: {
          assigned_at: string | null
          assigned_by: string | null
          client_id: string | null
          created_at: string
          fillout_form_id: string | null
          fillout_submission_id: string | null
          form_id: string | null
          form_name: string | null
          form_type: string | null
          id: string
          raw_payload: Json
          response_json: Json
          submitted_at: string | null
          unmatch_reason: string | null
          unmatched: boolean
          unread: boolean
          updated_at: string
        }
        Insert: {
          assigned_at?: string | null
          assigned_by?: string | null
          client_id?: string | null
          created_at?: string
          fillout_form_id?: string | null
          fillout_submission_id?: string | null
          form_id?: string | null
          form_name?: string | null
          form_type?: string | null
          id?: string
          raw_payload?: Json
          response_json?: Json
          submitted_at?: string | null
          unmatch_reason?: string | null
          unmatched?: boolean
          unread?: boolean
          updated_at?: string
        }
        Update: {
          assigned_at?: string | null
          assigned_by?: string | null
          client_id?: string | null
          created_at?: string
          fillout_form_id?: string | null
          fillout_submission_id?: string | null
          form_id?: string | null
          form_name?: string | null
          form_type?: string | null
          id?: string
          raw_payload?: Json
          response_json?: Json
          submitted_at?: string | null
          unmatch_reason?: string | null
          unmatched?: boolean
          unread?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fillout_submissions_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fillout_submissions_form_id_fkey"
            columns: ["form_id"]
            isOneToOne: false
            referencedRelation: "nf_forms"
            referencedColumns: ["id"]
          },
        ]
      }
      form_client_assignments: {
        Row: {
          assigned_by: string | null
          client_id: string
          created_at: string
          form_id: string
          id: string
        }
        Insert: {
          assigned_by?: string | null
          client_id: string
          created_at?: string
          form_id: string
          id?: string
        }
        Update: {
          assigned_by?: string | null
          client_id?: string
          created_at?: string
          form_id?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "form_client_assignments_form_id_fkey"
            columns: ["form_id"]
            isOneToOne: false
            referencedRelation: "forms"
            referencedColumns: ["id"]
          },
        ]
      }
      forms: {
        Row: {
          active: boolean
          archived: boolean
          archived_at: string | null
          archived_by: string | null
          created_at: string
          created_by: string | null
          custom_type: string | null
          description: string | null
          form_type: string
          id: string
          notes_admin: string | null
          title: string
          updated_at: string
          url: string
          visible_to_client: boolean
        }
        Insert: {
          active?: boolean
          archived?: boolean
          archived_at?: string | null
          archived_by?: string | null
          created_at?: string
          created_by?: string | null
          custom_type?: string | null
          description?: string | null
          form_type?: string
          id?: string
          notes_admin?: string | null
          title: string
          updated_at?: string
          url: string
          visible_to_client?: boolean
        }
        Update: {
          active?: boolean
          archived?: boolean
          archived_at?: string | null
          archived_by?: string | null
          created_at?: string
          created_by?: string | null
          custom_type?: string | null
          description?: string | null
          form_type?: string
          id?: string
          notes_admin?: string | null
          title?: string
          updated_at?: string
          url?: string
          visible_to_client?: boolean
        }
        Relationships: []
      }
      google_calendar_connections: {
        Row: {
          access_token: string | null
          coach_id: string
          created_at: string
          google_account_email: string | null
          id: string
          last_error: string | null
          last_synced_at: string | null
          refresh_token: string | null
          scopes: string | null
          selected_calendar_id: string | null
          selected_calendar_name: string | null
          status: Database["public"]["Enums"]["gcal_connection_status"]
          token_expires_at: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          access_token?: string | null
          coach_id: string
          created_at?: string
          google_account_email?: string | null
          id?: string
          last_error?: string | null
          last_synced_at?: string | null
          refresh_token?: string | null
          scopes?: string | null
          selected_calendar_id?: string | null
          selected_calendar_name?: string | null
          status?: Database["public"]["Enums"]["gcal_connection_status"]
          token_expires_at?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          access_token?: string | null
          coach_id?: string
          created_at?: string
          google_account_email?: string | null
          id?: string
          last_error?: string | null
          last_synced_at?: string | null
          refresh_token?: string | null
          scopes?: string | null
          selected_calendar_id?: string | null
          selected_calendar_name?: string | null
          status?: Database["public"]["Enums"]["gcal_connection_status"]
          token_expires_at?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "google_calendar_connections_coach_id_fkey"
            columns: ["coach_id"]
            isOneToOne: true
            referencedRelation: "coaches"
            referencedColumns: ["id"]
          },
        ]
      }
      group_message_reactions: {
        Row: {
          created_at: string
          emoji: string
          id: string
          message_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          emoji: string
          id?: string
          message_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          emoji?: string
          id?: string
          message_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "group_message_reactions_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "group_messages"
            referencedColumns: ["id"]
          },
        ]
      }
      group_messages: {
        Row: {
          attachments: Json
          body: string
          created_at: string
          deleted_at: string | null
          edited_at: string | null
          group_id: string
          id: string
          sender_id: string | null
          sender_role: string
        }
        Insert: {
          attachments?: Json
          body?: string
          created_at?: string
          deleted_at?: string | null
          edited_at?: string | null
          group_id: string
          id?: string
          sender_id?: string | null
          sender_role?: string
        }
        Update: {
          attachments?: Json
          body?: string
          created_at?: string
          deleted_at?: string | null
          edited_at?: string | null
          group_id?: string
          id?: string
          sender_id?: string | null
          sender_role?: string
        }
        Relationships: [
          {
            foreignKeyName: "group_messages_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "chat_groups"
            referencedColumns: ["id"]
          },
        ]
      }
      important_dates: {
        Row: {
          approaching_soon_days: number
          client_id: string
          countdown_label: string | null
          created_at: string
          custom_type: string | null
          date_type: string
          id: string
          notes: string | null
          phase_id: string | null
          program_link: string | null
          sort_order: number
          start_date: string | null
          status: string
          target_date: string
          title: string
          updated_at: string
          visible_to_client: boolean
        }
        Insert: {
          approaching_soon_days?: number
          client_id: string
          countdown_label?: string | null
          created_at?: string
          custom_type?: string | null
          date_type?: string
          id?: string
          notes?: string | null
          phase_id?: string | null
          program_link?: string | null
          sort_order?: number
          start_date?: string | null
          status?: string
          target_date: string
          title: string
          updated_at?: string
          visible_to_client?: boolean
        }
        Update: {
          approaching_soon_days?: number
          client_id?: string
          countdown_label?: string | null
          created_at?: string
          custom_type?: string | null
          date_type?: string
          id?: string
          notes?: string | null
          phase_id?: string | null
          program_link?: string | null
          sort_order?: number
          start_date?: string | null
          status?: string
          target_date?: string
          title?: string
          updated_at?: string
          visible_to_client?: boolean
        }
        Relationships: []
      }
      jf_billing_events: {
        Row: {
          customer_id: string | null
          id: string
          member_id: string | null
          payload: Json | null
          processed_at: string
          stripe_event_id: string
          subscription_id: string | null
          type: string
        }
        Insert: {
          customer_id?: string | null
          id?: string
          member_id?: string | null
          payload?: Json | null
          processed_at?: string
          stripe_event_id: string
          subscription_id?: string | null
          type: string
        }
        Update: {
          customer_id?: string | null
          id?: string
          member_id?: string | null
          payload?: Json | null
          processed_at?: string
          stripe_event_id?: string
          subscription_id?: string | null
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "jf_billing_events_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "app_members"
            referencedColumns: ["id"]
          },
        ]
      }
      jf_cancellation_feedback: {
        Row: {
          created_at: string
          details: string | null
          id: string
          member_id: string
          reason: string | null
        }
        Insert: {
          created_at?: string
          details?: string | null
          id?: string
          member_id: string
          reason?: string | null
        }
        Update: {
          created_at?: string
          details?: string | null
          id?: string
          member_id?: string
          reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "jf_cancellation_feedback_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "app_members"
            referencedColumns: ["id"]
          },
        ]
      }
      jf_membership_settings: {
        Row: {
          hold_price_display: string
          hold_price_id: string | null
          id: boolean
          monthly_price_display: string
          monthly_price_id: string | null
          refund_policy: string
          stripe_mode: string
          support_email: string | null
          trial_days: number
          updated_at: string
          upgrade_coaching_url: string | null
        }
        Insert: {
          hold_price_display?: string
          hold_price_id?: string | null
          id?: boolean
          monthly_price_display?: string
          monthly_price_id?: string | null
          refund_policy?: string
          stripe_mode?: string
          support_email?: string | null
          trial_days?: number
          updated_at?: string
          upgrade_coaching_url?: string | null
        }
        Update: {
          hold_price_display?: string
          hold_price_id?: string | null
          id?: boolean
          monthly_price_display?: string
          monthly_price_id?: string | null
          refund_policy?: string
          stripe_mode?: string
          support_email?: string | null
          trial_days?: number
          updated_at?: string
          upgrade_coaching_url?: string | null
        }
        Relationships: []
      }
      jf_pending_signups: {
        Row: {
          created_at: string
          email: string
          expires_at: string
          full_name: string
          id: string
          password_hash: string
          phone: string | null
          session_id: string
          sms_consent: boolean
        }
        Insert: {
          created_at?: string
          email: string
          expires_at?: string
          full_name: string
          id?: string
          password_hash: string
          phone?: string | null
          session_id: string
          sms_consent?: boolean
        }
        Update: {
          created_at?: string
          email?: string
          expires_at?: string
          full_name?: string
          id?: string
          password_hash?: string
          phone?: string | null
          session_id?: string
          sms_consent?: boolean
        }
        Relationships: []
      }
      jf_trial_emails: {
        Row: {
          email_lc: string
          first_trial_at: string
          stripe_customer_id: string | null
        }
        Insert: {
          email_lc: string
          first_trial_at?: string
          stripe_customer_id?: string | null
        }
        Update: {
          email_lc?: string
          first_trial_at?: string
          stripe_customer_id?: string | null
        }
        Relationships: []
      }
      lift_video_comments: {
        Row: {
          attachments: Json | null
          author_id: string | null
          author_role: string
          body: string
          client_id: string
          created_at: string
          id: string
          is_internal_note: boolean
          updated_at: string
          video_id: string
          video_timestamp_seconds: number | null
        }
        Insert: {
          attachments?: Json | null
          author_id?: string | null
          author_role: string
          body?: string
          client_id: string
          created_at?: string
          id?: string
          is_internal_note?: boolean
          updated_at?: string
          video_id: string
          video_timestamp_seconds?: number | null
        }
        Update: {
          attachments?: Json | null
          author_id?: string | null
          author_role?: string
          body?: string
          client_id?: string
          created_at?: string
          id?: string
          is_internal_note?: boolean
          updated_at?: string
          video_id?: string
          video_timestamp_seconds?: number | null
        }
        Relationships: []
      }
      lift_videos: {
        Row: {
          admin_last_viewed_at: string | null
          archive_attempts: number
          archive_error: string | null
          archive_last_attempt_at: string | null
          archive_next_attempt_at: string | null
          archive_status: string | null
          archived: boolean
          archived_at: string | null
          archived_by: string | null
          batch_id: string | null
          batch_index: number | null
          batch_note: string | null
          batch_size: number | null
          client_id: string
          client_last_viewed_at: string | null
          client_notes: string | null
          created_at: string
          custom_tag: string | null
          custom_training_day: string | null
          date_performed: string | null
          drive_embed_url: string | null
          drive_file_id: string | null
          drive_folder_id: string | null
          drive_url: string | null
          exercise: string
          file_size_bytes: number | null
          file_type: string | null
          id: string
          important_date_id: string | null
          is_urgent: boolean
          liked_at: string | null
          liked_by: string | null
          load_text: string | null
          original_drive_file_id: string | null
          original_drive_url: string | null
          phase_id: string | null
          playback_error: string | null
          preview_error: string | null
          preview_status: string
          preview_url: string | null
          program_day: string | null
          question_for_coach: string | null
          reps: number | null
          reviewed_at: string | null
          reviewed_by: string | null
          rpe: number | null
          set_number: number | null
          status: string
          tag: string
          thumbnail_url: string | null
          training_day: string | null
          updated_at: string
          upload_status: string
          uploaded_by: string | null
          video_source: string
          video_storage_path: string | null
          video_url: string | null
          watched_at: string | null
          watched_by: string | null
        }
        Insert: {
          admin_last_viewed_at?: string | null
          archive_attempts?: number
          archive_error?: string | null
          archive_last_attempt_at?: string | null
          archive_next_attempt_at?: string | null
          archive_status?: string | null
          archived?: boolean
          archived_at?: string | null
          archived_by?: string | null
          batch_id?: string | null
          batch_index?: number | null
          batch_note?: string | null
          batch_size?: number | null
          client_id: string
          client_last_viewed_at?: string | null
          client_notes?: string | null
          created_at?: string
          custom_tag?: string | null
          custom_training_day?: string | null
          date_performed?: string | null
          drive_embed_url?: string | null
          drive_file_id?: string | null
          drive_folder_id?: string | null
          drive_url?: string | null
          exercise?: string
          file_size_bytes?: number | null
          file_type?: string | null
          id?: string
          important_date_id?: string | null
          is_urgent?: boolean
          liked_at?: string | null
          liked_by?: string | null
          load_text?: string | null
          original_drive_file_id?: string | null
          original_drive_url?: string | null
          phase_id?: string | null
          playback_error?: string | null
          preview_error?: string | null
          preview_status?: string
          preview_url?: string | null
          program_day?: string | null
          question_for_coach?: string | null
          reps?: number | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          rpe?: number | null
          set_number?: number | null
          status?: string
          tag?: string
          thumbnail_url?: string | null
          training_day?: string | null
          updated_at?: string
          upload_status?: string
          uploaded_by?: string | null
          video_source?: string
          video_storage_path?: string | null
          video_url?: string | null
          watched_at?: string | null
          watched_by?: string | null
        }
        Update: {
          admin_last_viewed_at?: string | null
          archive_attempts?: number
          archive_error?: string | null
          archive_last_attempt_at?: string | null
          archive_next_attempt_at?: string | null
          archive_status?: string | null
          archived?: boolean
          archived_at?: string | null
          archived_by?: string | null
          batch_id?: string | null
          batch_index?: number | null
          batch_note?: string | null
          batch_size?: number | null
          client_id?: string
          client_last_viewed_at?: string | null
          client_notes?: string | null
          created_at?: string
          custom_tag?: string | null
          custom_training_day?: string | null
          date_performed?: string | null
          drive_embed_url?: string | null
          drive_file_id?: string | null
          drive_folder_id?: string | null
          drive_url?: string | null
          exercise?: string
          file_size_bytes?: number | null
          file_type?: string | null
          id?: string
          important_date_id?: string | null
          is_urgent?: boolean
          liked_at?: string | null
          liked_by?: string | null
          load_text?: string | null
          original_drive_file_id?: string | null
          original_drive_url?: string | null
          phase_id?: string | null
          playback_error?: string | null
          preview_error?: string | null
          preview_status?: string
          preview_url?: string | null
          program_day?: string | null
          question_for_coach?: string | null
          reps?: number | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          rpe?: number | null
          set_number?: number | null
          status?: string
          tag?: string
          thumbnail_url?: string | null
          training_day?: string | null
          updated_at?: string
          upload_status?: string
          uploaded_by?: string | null
          video_source?: string
          video_storage_path?: string | null
          video_url?: string | null
          watched_at?: string | null
          watched_by?: string | null
        }
        Relationships: []
      }
      manual_check_in_reviews: {
        Row: {
          action_items: string | null
          check_in_date: string | null
          client_id: string
          coach_user_id: string
          created_at: string
          dismissed_at: string | null
          external_link: string | null
          id: string
          internal_notes: string | null
          message: string
          notify_client: boolean
          priority: string | null
          read_at: string | null
          seen_at: string | null
          source: string
          title: string
          updated_at: string
        }
        Insert: {
          action_items?: string | null
          check_in_date?: string | null
          client_id: string
          coach_user_id: string
          created_at?: string
          dismissed_at?: string | null
          external_link?: string | null
          id?: string
          internal_notes?: string | null
          message: string
          notify_client?: boolean
          priority?: string | null
          read_at?: string | null
          seen_at?: string | null
          source?: string
          title?: string
          updated_at?: string
        }
        Update: {
          action_items?: string | null
          check_in_date?: string | null
          client_id?: string
          coach_user_id?: string
          created_at?: string
          dismissed_at?: string | null
          external_link?: string | null
          id?: string
          internal_notes?: string | null
          message?: string
          notify_client?: boolean
          priority?: string | null
          read_at?: string | null
          seen_at?: string | null
          source?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "manual_check_in_reviews_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      mass_message_log: {
        Row: {
          audience_summary: string | null
          body: string
          created_at: string
          group_id: string | null
          id: string
          mode: string
          recipient_count: number
          sent_by: string | null
        }
        Insert: {
          audience_summary?: string | null
          body?: string
          created_at?: string
          group_id?: string | null
          id?: string
          mode: string
          recipient_count?: number
          sent_by?: string | null
        }
        Update: {
          audience_summary?: string | null
          body?: string
          created_at?: string
          group_id?: string | null
          id?: string
          mode?: string
          recipient_count?: number
          sent_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "mass_message_log_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "chat_groups"
            referencedColumns: ["id"]
          },
        ]
      }
      media_archive_settings: {
        Row: {
          auto_archive_enabled: boolean
          chat_media_retention_days: number
          checkin_retention_days: number
          created_at: string
          default_visibility: string
          id: string
          last_run_at: string | null
          last_run_summary: string | null
          lift_video_retention_days: number
          progress_retention_days: number
          singleton: boolean
          updated_at: string
        }
        Insert: {
          auto_archive_enabled?: boolean
          chat_media_retention_days?: number
          checkin_retention_days?: number
          created_at?: string
          default_visibility?: string
          id?: string
          last_run_at?: string | null
          last_run_summary?: string | null
          lift_video_retention_days?: number
          progress_retention_days?: number
          singleton?: boolean
          updated_at?: string
        }
        Update: {
          auto_archive_enabled?: boolean
          chat_media_retention_days?: number
          checkin_retention_days?: number
          created_at?: string
          default_visibility?: string
          id?: string
          last_run_at?: string | null
          last_run_summary?: string | null
          lift_video_retention_days?: number
          progress_retention_days?: number
          singleton?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      media_archives: {
        Row: {
          archive_status: string
          archived_at: string | null
          attempts: number
          client_id: string
          created_at: string
          created_by: string | null
          drive_file_id: string | null
          drive_folder_id: string | null
          drive_folder_path: string | null
          drive_url: string | null
          file_name: string | null
          id: string
          last_error: string | null
          marketing_visibility: Database["public"]["Enums"]["media_visibility"]
          mime_type: string | null
          restored_at: string | null
          size_bytes: number | null
          source_id: string
          source_subkey: string | null
          source_type: string
          updated_at: string
          visibility: string
        }
        Insert: {
          archive_status?: string
          archived_at?: string | null
          attempts?: number
          client_id: string
          created_at?: string
          created_by?: string | null
          drive_file_id?: string | null
          drive_folder_id?: string | null
          drive_folder_path?: string | null
          drive_url?: string | null
          file_name?: string | null
          id?: string
          last_error?: string | null
          marketing_visibility?: Database["public"]["Enums"]["media_visibility"]
          mime_type?: string | null
          restored_at?: string | null
          size_bytes?: number | null
          source_id: string
          source_subkey?: string | null
          source_type: string
          updated_at?: string
          visibility?: string
        }
        Update: {
          archive_status?: string
          archived_at?: string | null
          attempts?: number
          client_id?: string
          created_at?: string
          created_by?: string | null
          drive_file_id?: string | null
          drive_folder_id?: string | null
          drive_folder_path?: string | null
          drive_url?: string | null
          file_name?: string | null
          id?: string
          last_error?: string | null
          marketing_visibility?: Database["public"]["Enums"]["media_visibility"]
          mime_type?: string | null
          restored_at?: string | null
          size_bytes?: number | null
          source_id?: string
          source_subkey?: string | null
          source_type?: string
          updated_at?: string
          visibility?: string
        }
        Relationships: [
          {
            foreignKeyName: "media_archives_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      media_comments: {
        Row: {
          author_id: string | null
          author_role: string
          body: string
          client_id: string
          comment_type: string
          created_at: string
          id: string
          is_internal_note: boolean
          media_item_id: string
          updated_at: string
          video_timestamp_seconds: number | null
        }
        Insert: {
          author_id?: string | null
          author_role: string
          body?: string
          client_id: string
          comment_type?: string
          created_at?: string
          id?: string
          is_internal_note?: boolean
          media_item_id: string
          updated_at?: string
          video_timestamp_seconds?: number | null
        }
        Update: {
          author_id?: string | null
          author_role?: string
          body?: string
          client_id?: string
          comment_type?: string
          created_at?: string
          id?: string
          is_internal_note?: boolean
          media_item_id?: string
          updated_at?: string
          video_timestamp_seconds?: number | null
        }
        Relationships: []
      }
      media_drive_settings: {
        Row: {
          created_at: string
          id: string
          last_test_at: string | null
          last_test_result: string | null
          notes: string | null
          root_folder_id: string | null
          root_folder_name: string | null
          root_folder_url: string | null
          share_uploads_with_link: boolean
          singleton: boolean
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          last_test_at?: string | null
          last_test_result?: string | null
          notes?: string | null
          root_folder_id?: string | null
          root_folder_name?: string | null
          root_folder_url?: string | null
          share_uploads_with_link?: boolean
          singleton?: boolean
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          last_test_at?: string | null
          last_test_result?: string | null
          notes?: string | null
          root_folder_id?: string | null
          root_folder_name?: string | null
          root_folder_url?: string | null
          share_uploads_with_link?: boolean
          singleton?: boolean
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      media_items: {
        Row: {
          admin_last_viewed_at: string | null
          archive_status: string | null
          archived: boolean
          archived_at: string | null
          archived_by: string | null
          client_id: string
          client_last_viewed_at: string | null
          clip_note: string | null
          clip_order: number
          created_at: string
          drive_embed_url: string | null
          drive_file_id: string | null
          drive_folder_id: string | null
          drive_url: string | null
          duration_seconds: number | null
          external_link: string | null
          file_name: string | null
          id: string
          liked_at: string | null
          liked_by: string | null
          marketing_visibility: Database["public"]["Enums"]["media_visibility"]
          media_type: string
          mime_type: string | null
          pain_note: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          size_bytes: number | null
          status: string
          submission_id: string | null
          thumbnail_url: string | null
          updated_at: string
          uploaded_by: string | null
          uploaded_by_role: string
          urgent_flag: boolean
          watched_at: string | null
          watched_by: string | null
        }
        Insert: {
          admin_last_viewed_at?: string | null
          archive_status?: string | null
          archived?: boolean
          archived_at?: string | null
          archived_by?: string | null
          client_id: string
          client_last_viewed_at?: string | null
          clip_note?: string | null
          clip_order?: number
          created_at?: string
          drive_embed_url?: string | null
          drive_file_id?: string | null
          drive_folder_id?: string | null
          drive_url?: string | null
          duration_seconds?: number | null
          external_link?: string | null
          file_name?: string | null
          id?: string
          liked_at?: string | null
          liked_by?: string | null
          marketing_visibility?: Database["public"]["Enums"]["media_visibility"]
          media_type: string
          mime_type?: string | null
          pain_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          size_bytes?: number | null
          status?: string
          submission_id?: string | null
          thumbnail_url?: string | null
          updated_at?: string
          uploaded_by?: string | null
          uploaded_by_role?: string
          urgent_flag?: boolean
          watched_at?: string | null
          watched_by?: string | null
        }
        Update: {
          admin_last_viewed_at?: string | null
          archive_status?: string | null
          archived?: boolean
          archived_at?: string | null
          archived_by?: string | null
          client_id?: string
          client_last_viewed_at?: string | null
          clip_note?: string | null
          clip_order?: number
          created_at?: string
          drive_embed_url?: string | null
          drive_file_id?: string | null
          drive_folder_id?: string | null
          drive_url?: string | null
          duration_seconds?: number | null
          external_link?: string | null
          file_name?: string | null
          id?: string
          liked_at?: string | null
          liked_by?: string | null
          marketing_visibility?: Database["public"]["Enums"]["media_visibility"]
          media_type?: string
          mime_type?: string | null
          pain_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          size_bytes?: number | null
          status?: string
          submission_id?: string | null
          thumbnail_url?: string | null
          updated_at?: string
          uploaded_by?: string | null
          uploaded_by_role?: string
          urgent_flag?: boolean
          watched_at?: string | null
          watched_by?: string | null
        }
        Relationships: []
      }
      media_resource_comments: {
        Row: {
          body: string
          created_at: string
          id: string
          resource_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          body: string
          created_at?: string
          id?: string
          resource_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          body?: string
          created_at?: string
          id?: string
          resource_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "media_resource_comments_resource_id_fkey"
            columns: ["resource_id"]
            isOneToOne: false
            referencedRelation: "media_resources"
            referencedColumns: ["id"]
          },
        ]
      }
      media_resource_folders: {
        Row: {
          color: string | null
          created_at: string
          created_by: string | null
          icon: string | null
          id: string
          name: string
          parent_id: string | null
          sort_order: number
          updated_at: string
        }
        Insert: {
          color?: string | null
          created_at?: string
          created_by?: string | null
          icon?: string | null
          id?: string
          name: string
          parent_id?: string | null
          sort_order?: number
          updated_at?: string
        }
        Update: {
          color?: string | null
          created_at?: string
          created_by?: string | null
          icon?: string | null
          id?: string
          name?: string
          parent_id?: string | null
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "media_resource_folders_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "media_resource_folders"
            referencedColumns: ["id"]
          },
        ]
      }
      media_resources: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          external_url: string | null
          file_size: number | null
          folder_id: string | null
          id: string
          mime_type: string | null
          name: string
          search_text: unknown
          storage_path: string | null
          tags: string[]
          thumbnail_path: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          external_url?: string | null
          file_size?: number | null
          folder_id?: string | null
          id?: string
          mime_type?: string | null
          name: string
          search_text?: unknown
          storage_path?: string | null
          tags?: string[]
          thumbnail_path?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          external_url?: string | null
          file_size?: number | null
          folder_id?: string | null
          id?: string
          mime_type?: string | null
          name?: string
          search_text?: unknown
          storage_path?: string | null
          tags?: string[]
          thumbnail_path?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "media_resources_folder_id_fkey"
            columns: ["folder_id"]
            isOneToOne: false
            referencedRelation: "media_resource_folders"
            referencedColumns: ["id"]
          },
        ]
      }
      media_submissions: {
        Row: {
          batch_note: string | null
          client_id: string
          clip_count: number
          created_at: string
          created_by: string | null
          created_by_role: string
          id: string
          pain_note: string | null
          status: string
          submission_type: string
          title: string | null
          updated_at: string
          urgent_flag: boolean
        }
        Insert: {
          batch_note?: string | null
          client_id: string
          clip_count?: number
          created_at?: string
          created_by?: string | null
          created_by_role?: string
          id?: string
          pain_note?: string | null
          status?: string
          submission_type: string
          title?: string | null
          updated_at?: string
          urgent_flag?: boolean
        }
        Update: {
          batch_note?: string | null
          client_id?: string
          clip_count?: number
          created_at?: string
          created_by?: string | null
          created_by_role?: string
          id?: string
          pain_note?: string | null
          status?: string
          submission_type?: string
          title?: string | null
          updated_at?: string
          urgent_flag?: boolean
        }
        Relationships: []
      }
      member_access: {
        Row: {
          access_level_key: string
          active: boolean
          created_at: string
          expires_at: string | null
          granted_at: string
          id: string
          member_id: string
          notes: string | null
          offer_id: string | null
          source: string
          updated_at: string
        }
        Insert: {
          access_level_key: string
          active?: boolean
          created_at?: string
          expires_at?: string | null
          granted_at?: string
          id?: string
          member_id: string
          notes?: string | null
          offer_id?: string | null
          source?: string
          updated_at?: string
        }
        Update: {
          access_level_key?: string
          active?: boolean
          created_at?: string
          expires_at?: string | null
          granted_at?: string
          id?: string
          member_id?: string
          notes?: string | null
          offer_id?: string | null
          source?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "member_access_access_level_key_fkey"
            columns: ["access_level_key"]
            isOneToOne: false
            referencedRelation: "access_levels"
            referencedColumns: ["key"]
          },
          {
            foreignKeyName: "member_access_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "app_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "member_access_offer_id_fkey"
            columns: ["offer_id"]
            isOneToOne: false
            referencedRelation: "offers"
            referencedColumns: ["id"]
          },
        ]
      }
      member_access_defaults: {
        Row: {
          access_level_key: string
          account_type: string
          created_at: string
          enabled: boolean
          id: string
          notes: string | null
          updated_at: string
        }
        Insert: {
          access_level_key: string
          account_type: string
          created_at?: string
          enabled?: boolean
          id?: string
          notes?: string | null
          updated_at?: string
        }
        Update: {
          access_level_key?: string
          account_type?: string
          created_at?: string
          enabled?: boolean
          id?: string
          notes?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "member_access_defaults_access_level_key_fkey"
            columns: ["access_level_key"]
            isOneToOne: false
            referencedRelation: "access_levels"
            referencedColumns: ["key"]
          },
        ]
      }
      member_plan_enrollments: {
        Row: {
          completed_at: string | null
          created_at: string
          current_week: number
          id: string
          member_id: string
          notes: string | null
          plan_id: string
          started_at: string
          status: string
          updated_at: string
          workouts_completed: number
          workouts_total: number
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          current_week?: number
          id?: string
          member_id: string
          notes?: string | null
          plan_id: string
          started_at?: string
          status?: string
          updated_at?: string
          workouts_completed?: number
          workouts_total?: number
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          current_week?: number
          id?: string
          member_id?: string
          notes?: string | null
          plan_id?: string
          started_at?: string
          status?: string
          updated_at?: string
          workouts_completed?: number
          workouts_total?: number
        }
        Relationships: [
          {
            foreignKeyName: "member_plan_enrollments_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "app_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "member_plan_enrollments_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "member_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      member_plans: {
        Row: {
          cover_image_url: string | null
          created_at: string
          created_by: string | null
          days_per_week: number
          description: string | null
          difficulty: string
          equipment_needed: string[]
          est_minutes_per_workout: number | null
          featured: boolean
          goal: string | null
          id: string
          logging_enabled: boolean
          name: string
          published_payload: Json
          required_access_level: string
          source_block_id: string | null
          source_template_id: string | null
          status: string
          tags: string[]
          tracking_enabled: boolean
          training_style: string
          updated_at: string
          weeks: number
          workouts_total: number
        }
        Insert: {
          cover_image_url?: string | null
          created_at?: string
          created_by?: string | null
          days_per_week?: number
          description?: string | null
          difficulty?: string
          equipment_needed?: string[]
          est_minutes_per_workout?: number | null
          featured?: boolean
          goal?: string | null
          id?: string
          logging_enabled?: boolean
          name: string
          published_payload?: Json
          required_access_level?: string
          source_block_id?: string | null
          source_template_id?: string | null
          status?: string
          tags?: string[]
          tracking_enabled?: boolean
          training_style?: string
          updated_at?: string
          weeks?: number
          workouts_total?: number
        }
        Update: {
          cover_image_url?: string | null
          created_at?: string
          created_by?: string | null
          days_per_week?: number
          description?: string | null
          difficulty?: string
          equipment_needed?: string[]
          est_minutes_per_workout?: number | null
          featured?: boolean
          goal?: string | null
          id?: string
          logging_enabled?: boolean
          name?: string
          published_payload?: Json
          required_access_level?: string
          source_block_id?: string | null
          source_template_id?: string | null
          status?: string
          tags?: string[]
          tracking_enabled?: boolean
          training_style?: string
          updated_at?: string
          weeks?: number
          workouts_total?: number
        }
        Relationships: [
          {
            foreignKeyName: "member_plans_required_access_level_fkey"
            columns: ["required_access_level"]
            isOneToOne: false
            referencedRelation: "access_levels"
            referencedColumns: ["key"]
          },
          {
            foreignKeyName: "member_plans_source_block_id_fkey"
            columns: ["source_block_id"]
            isOneToOne: false
            referencedRelation: "pl_blocks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "member_plans_source_template_id_fkey"
            columns: ["source_template_id"]
            isOneToOne: false
            referencedRelation: "pl_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      member_resources: {
        Row: {
          body_md: string | null
          created_at: string
          created_by: string | null
          description: string | null
          featured: boolean
          format: string
          id: string
          kind: string
          required_access_level: string
          slug: string
          sort_order: number
          status: string
          storage_path: string | null
          thumbnail_url: string | null
          title: string
          updated_at: string
          url: string | null
        }
        Insert: {
          body_md?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          featured?: boolean
          format?: string
          id?: string
          kind?: string
          required_access_level?: string
          slug: string
          sort_order?: number
          status?: string
          storage_path?: string | null
          thumbnail_url?: string | null
          title: string
          updated_at?: string
          url?: string | null
        }
        Update: {
          body_md?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          featured?: boolean
          format?: string
          id?: string
          kind?: string
          required_access_level?: string
          slug?: string
          sort_order?: number
          status?: string
          storage_path?: string | null
          thumbnail_url?: string | null
          title?: string
          updated_at?: string
          url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "member_resources_required_access_level_fkey"
            columns: ["required_access_level"]
            isOneToOne: false
            referencedRelation: "access_levels"
            referencedColumns: ["key"]
          },
        ]
      }
      member_set_logs: {
        Row: {
          created_at: string
          day_index: number
          enrollment_id: string
          exercise_index: number
          id: string
          load_kg: number | null
          load_lb: number | null
          logged_at: string
          notes: string | null
          reps: number | null
          rir: number | null
          rpe: number | null
          set_index: number
          updated_at: string
          week_index: number
        }
        Insert: {
          created_at?: string
          day_index: number
          enrollment_id: string
          exercise_index: number
          id?: string
          load_kg?: number | null
          load_lb?: number | null
          logged_at?: string
          notes?: string | null
          reps?: number | null
          rir?: number | null
          rpe?: number | null
          set_index: number
          updated_at?: string
          week_index: number
        }
        Update: {
          created_at?: string
          day_index?: number
          enrollment_id?: string
          exercise_index?: number
          id?: string
          load_kg?: number | null
          load_lb?: number | null
          logged_at?: string
          notes?: string | null
          reps?: number | null
          rir?: number | null
          rpe?: number | null
          set_index?: number
          updated_at?: string
          week_index?: number
        }
        Relationships: [
          {
            foreignKeyName: "member_set_logs_enrollment_id_fkey"
            columns: ["enrollment_id"]
            isOneToOne: false
            referencedRelation: "member_plan_enrollments"
            referencedColumns: ["id"]
          },
        ]
      }
      member_workout_completions: {
        Row: {
          completed_at: string
          created_at: string
          day_index: number
          enrollment_id: string
          id: string
          notes: string | null
          week_index: number
        }
        Insert: {
          completed_at?: string
          created_at?: string
          day_index: number
          enrollment_id: string
          id?: string
          notes?: string | null
          week_index: number
        }
        Update: {
          completed_at?: string
          created_at?: string
          day_index?: number
          enrollment_id?: string
          id?: string
          notes?: string | null
          week_index?: number
        }
        Relationships: [
          {
            foreignKeyName: "member_workout_completions_enrollment_id_fkey"
            columns: ["enrollment_id"]
            isOneToOne: false
            referencedRelation: "member_plan_enrollments"
            referencedColumns: ["id"]
          },
        ]
      }
      message_reactions: {
        Row: {
          created_at: string
          emoji: string
          id: string
          message_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          emoji: string
          id?: string
          message_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          emoji?: string
          id?: string
          message_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "message_reactions_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          attachments: Json
          body: string
          client_id: string
          created_at: string
          deleted_at: string | null
          edited_at: string | null
          id: string
          is_internal_note: boolean
          message_type: string
          priority: string | null
          read_by_admin_at: string | null
          read_by_client_at: string | null
          sender_id: string | null
          sender_role: string
          transcript: string | null
          transcript_status: string | null
          updated_at: string
        }
        Insert: {
          attachments?: Json
          body?: string
          client_id: string
          created_at?: string
          deleted_at?: string | null
          edited_at?: string | null
          id?: string
          is_internal_note?: boolean
          message_type?: string
          priority?: string | null
          read_by_admin_at?: string | null
          read_by_client_at?: string | null
          sender_id?: string | null
          sender_role: string
          transcript?: string | null
          transcript_status?: string | null
          updated_at?: string
        }
        Update: {
          attachments?: Json
          body?: string
          client_id?: string
          created_at?: string
          deleted_at?: string | null
          edited_at?: string | null
          id?: string
          is_internal_note?: boolean
          message_type?: string
          priority?: string | null
          read_by_admin_at?: string | null
          read_by_client_at?: string | null
          sender_id?: string | null
          sender_role?: string
          transcript?: string | null
          transcript_status?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "messages_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      nf_answers: {
        Row: {
          created_at: string
          id: string
          question_id: string
          submission_id: string
          updated_at: string
          value_json: Json | null
          value_number: number | null
          value_text: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          question_id: string
          submission_id: string
          updated_at?: string
          value_json?: Json | null
          value_number?: number | null
          value_text?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          question_id?: string
          submission_id?: string
          updated_at?: string
          value_json?: Json | null
          value_number?: number | null
          value_text?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "nf_answers_question_id_fkey"
            columns: ["question_id"]
            isOneToOne: false
            referencedRelation: "nf_questions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "nf_answers_submission_id_fkey"
            columns: ["submission_id"]
            isOneToOne: false
            referencedRelation: "nf_submissions"
            referencedColumns: ["id"]
          },
        ]
      }
      nf_assignments: {
        Row: {
          assigned_by: string | null
          client_id: string
          created_at: string
          form_id: string
          id: string
          next_due_at: string | null
          recurrence: string
          updated_at: string
        }
        Insert: {
          assigned_by?: string | null
          client_id: string
          created_at?: string
          form_id: string
          id?: string
          next_due_at?: string | null
          recurrence?: string
          updated_at?: string
        }
        Update: {
          assigned_by?: string | null
          client_id?: string
          created_at?: string
          form_id?: string
          id?: string
          next_due_at?: string | null
          recurrence?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "nf_assignments_form_id_fkey"
            columns: ["form_id"]
            isOneToOne: false
            referencedRelation: "nf_forms"
            referencedColumns: ["id"]
          },
        ]
      }
      nf_files: {
        Row: {
          created_at: string
          id: string
          mime_type: string | null
          original_name: string | null
          question_id: string
          size_bytes: number | null
          storage_path: string
          submission_id: string
          uploaded_by: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          mime_type?: string | null
          original_name?: string | null
          question_id: string
          size_bytes?: number | null
          storage_path: string
          submission_id: string
          uploaded_by?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          mime_type?: string | null
          original_name?: string | null
          question_id?: string
          size_bytes?: number | null
          storage_path?: string
          submission_id?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "nf_files_question_id_fkey"
            columns: ["question_id"]
            isOneToOne: false
            referencedRelation: "nf_questions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "nf_files_submission_id_fkey"
            columns: ["submission_id"]
            isOneToOne: false
            referencedRelation: "nf_submissions"
            referencedColumns: ["id"]
          },
        ]
      }
      nf_forms: {
        Row: {
          active: boolean
          archived: boolean
          archived_at: string | null
          archived_by: string | null
          auto_assign_new_clients: boolean
          button_label: string | null
          created_at: string
          created_by: string | null
          description: string | null
          external_url: string | null
          form_type: string
          id: string
          kind: string
          open_style: string
          recurrence: string
          recurrence_day: string | null
          requires_client_identity: boolean
          title: string
          updated_at: string
          version: number
          visibility: string
        }
        Insert: {
          active?: boolean
          archived?: boolean
          archived_at?: string | null
          archived_by?: string | null
          auto_assign_new_clients?: boolean
          button_label?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          external_url?: string | null
          form_type?: string
          id?: string
          kind?: string
          open_style?: string
          recurrence?: string
          recurrence_day?: string | null
          requires_client_identity?: boolean
          title: string
          updated_at?: string
          version?: number
          visibility?: string
        }
        Update: {
          active?: boolean
          archived?: boolean
          archived_at?: string | null
          archived_by?: string | null
          auto_assign_new_clients?: boolean
          button_label?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          external_url?: string | null
          form_type?: string
          id?: string
          kind?: string
          open_style?: string
          recurrence?: string
          recurrence_day?: string | null
          requires_client_identity?: boolean
          title?: string
          updated_at?: string
          version?: number
          visibility?: string
        }
        Relationships: []
      }
      nf_questions: {
        Row: {
          conditional_logic: Json
          created_at: string
          form_id: string
          help_text: string | null
          id: string
          label: string
          options: Json
          order_index: number
          question_type: string
          required: boolean
          updated_at: string
          validation: Json
        }
        Insert: {
          conditional_logic?: Json
          created_at?: string
          form_id: string
          help_text?: string | null
          id?: string
          label: string
          options?: Json
          order_index?: number
          question_type: string
          required?: boolean
          updated_at?: string
          validation?: Json
        }
        Update: {
          conditional_logic?: Json
          created_at?: string
          form_id?: string
          help_text?: string | null
          id?: string
          label?: string
          options?: Json
          order_index?: number
          question_type?: string
          required?: boolean
          updated_at?: string
          validation?: Json
        }
        Relationships: [
          {
            foreignKeyName: "nf_questions_form_id_fkey"
            columns: ["form_id"]
            isOneToOne: false
            referencedRelation: "nf_forms"
            referencedColumns: ["id"]
          },
        ]
      }
      nf_reviews: {
        Row: {
          created_at: string
          id: string
          message_id: string | null
          reply_text: string
          reviewer_user_id: string
          sent_to_messenger_at: string | null
          submission_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          message_id?: string | null
          reply_text: string
          reviewer_user_id: string
          sent_to_messenger_at?: string | null
          submission_id: string
        }
        Update: {
          created_at?: string
          id?: string
          message_id?: string | null
          reply_text?: string
          reviewer_user_id?: string
          sent_to_messenger_at?: string | null
          submission_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "nf_reviews_submission_id_fkey"
            columns: ["submission_id"]
            isOneToOne: false
            referencedRelation: "nf_submissions"
            referencedColumns: ["id"]
          },
        ]
      }
      nf_submissions: {
        Row: {
          client_id: string
          created_at: string
          form_id: string
          id: string
          period_start: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          started_at: string
          status: string
          submitted_at: string | null
          updated_at: string
        }
        Insert: {
          client_id: string
          created_at?: string
          form_id: string
          id?: string
          period_start?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          started_at?: string
          status?: string
          submitted_at?: string | null
          updated_at?: string
        }
        Update: {
          client_id?: string
          created_at?: string
          form_id?: string
          id?: string
          period_start?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          started_at?: string
          status?: string
          submitted_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "nf_submissions_form_id_fkey"
            columns: ["form_id"]
            isOneToOne: false
            referencedRelation: "nf_forms"
            referencedColumns: ["id"]
          },
        ]
      }
      nutrition_target_days: {
        Row: {
          calories: number | null
          carbs: number | null
          created_at: string
          day_label: string
          fats: number | null
          fibre: number | null
          id: string
          notes: string | null
          protein: number | null
          sort_order: number
          target_id: string
        }
        Insert: {
          calories?: number | null
          carbs?: number | null
          created_at?: string
          day_label?: string
          fats?: number | null
          fibre?: number | null
          id?: string
          notes?: string | null
          protein?: number | null
          sort_order?: number
          target_id: string
        }
        Update: {
          calories?: number | null
          carbs?: number | null
          created_at?: string
          day_label?: string
          fats?: number | null
          fibre?: number | null
          id?: string
          notes?: string | null
          protein?: number | null
          sort_order?: number
          target_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "nutrition_target_days_target_id_fkey"
            columns: ["target_id"]
            isOneToOne: false
            referencedRelation: "nutrition_targets"
            referencedColumns: ["id"]
          },
        ]
      }
      nutrition_targets: {
        Row: {
          admin_notes: string | null
          client_id: string
          client_notes: string | null
          created_at: string
          custom_goal: string | null
          custom_phase: string | null
          end_date: string | null
          ending_soon_days: number
          goal: string
          id: string
          last_updated_at: string
          pdf_name: string | null
          pdf_url: string | null
          phase: string
          start_date: string
          status: string
          structure: string
          updated_at: string
          visible_to_client: boolean
          water: string | null
        }
        Insert: {
          admin_notes?: string | null
          client_id: string
          client_notes?: string | null
          created_at?: string
          custom_goal?: string | null
          custom_phase?: string | null
          end_date?: string | null
          ending_soon_days?: number
          goal?: string
          id?: string
          last_updated_at?: string
          pdf_name?: string | null
          pdf_url?: string | null
          phase?: string
          start_date: string
          status?: string
          structure?: string
          updated_at?: string
          visible_to_client?: boolean
          water?: string | null
        }
        Update: {
          admin_notes?: string | null
          client_id?: string
          client_notes?: string | null
          created_at?: string
          custom_goal?: string | null
          custom_phase?: string | null
          end_date?: string | null
          ending_soon_days?: number
          goal?: string
          id?: string
          last_updated_at?: string
          pdf_name?: string | null
          pdf_url?: string | null
          phase?: string
          start_date?: string
          status?: string
          structure?: string
          updated_at?: string
          visible_to_client?: boolean
          water?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "nutrition_targets_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      offers: {
        Row: {
          access_length: string | null
          admin_notes: string | null
          agreement_before_service: boolean
          agreement_required: boolean
          amount_due_today: number | null
          archived: boolean
          archived_at: string | null
          archived_by: string | null
          billing_day: number | null
          cancel_url: string | null
          cancellation_policy: string | null
          cancellation_window: string | null
          checkout_url: string | null
          commitment_end_date: string | null
          commitment_start_date: string | null
          commitment_term_length: string | null
          created_at: string
          currency: string | null
          default_agreement_template_id: string | null
          delivery_assets: Json
          delivery_notes: string | null
          deposit_amount: number | null
          description: string | null
          excluded_features: string[] | null
          expiration_date: string | null
          final_payment_date: string | null
          full_payable_amount: number | null
          gym_access_note: string | null
          id: string
          included_features: string[] | null
          installment_amount: number | null
          installment_due_day: number | null
          installment_frequency: string | null
          is_fixed_term_commitment: boolean | null
          is_member_facing: boolean
          is_recurring: boolean | null
          is_template: boolean
          last_edited_at: string | null
          late_arrival_policy: string | null
          late_failed_policy: string | null
          location: string | null
          member_tier_label: string | null
          minimum_commitment_length: string | null
          name: string
          no_show_policy: string | null
          notes: string | null
          number_of_payments: number | null
          offer_type: string | null
          package_expiry_date: string | null
          payment_amount: number | null
          payment_frequency: string | null
          payment_processing_note: string | null
          payment_start_date: string | null
          payment_structure: string | null
          price: number | null
          purchase_disclaimer: string | null
          refund_policy: string | null
          renewal_date: string | null
          required_agreement_template_id: string | null
          requires_agreement: boolean | null
          rescheduling_policy: string | null
          session_length_minutes: number | null
          sessions_included: number | null
          short_description: string | null
          status: string
          stripe_payment_link: string | null
          stripe_price_id: string | null
          stripe_product_id: string | null
          success_url: string | null
          taxes_included: boolean | null
          template_source_id: string | null
          term_duration: number | null
          term_duration_unit: string | null
          term_end_date: string | null
          term_start_date: string | null
          transferability_policy: string | null
          updated_at: string
          version: number
        }
        Insert: {
          access_length?: string | null
          admin_notes?: string | null
          agreement_before_service?: boolean
          agreement_required?: boolean
          amount_due_today?: number | null
          archived?: boolean
          archived_at?: string | null
          archived_by?: string | null
          billing_day?: number | null
          cancel_url?: string | null
          cancellation_policy?: string | null
          cancellation_window?: string | null
          checkout_url?: string | null
          commitment_end_date?: string | null
          commitment_start_date?: string | null
          commitment_term_length?: string | null
          created_at?: string
          currency?: string | null
          default_agreement_template_id?: string | null
          delivery_assets?: Json
          delivery_notes?: string | null
          deposit_amount?: number | null
          description?: string | null
          excluded_features?: string[] | null
          expiration_date?: string | null
          final_payment_date?: string | null
          full_payable_amount?: number | null
          gym_access_note?: string | null
          id?: string
          included_features?: string[] | null
          installment_amount?: number | null
          installment_due_day?: number | null
          installment_frequency?: string | null
          is_fixed_term_commitment?: boolean | null
          is_member_facing?: boolean
          is_recurring?: boolean | null
          is_template?: boolean
          last_edited_at?: string | null
          late_arrival_policy?: string | null
          late_failed_policy?: string | null
          location?: string | null
          member_tier_label?: string | null
          minimum_commitment_length?: string | null
          name: string
          no_show_policy?: string | null
          notes?: string | null
          number_of_payments?: number | null
          offer_type?: string | null
          package_expiry_date?: string | null
          payment_amount?: number | null
          payment_frequency?: string | null
          payment_processing_note?: string | null
          payment_start_date?: string | null
          payment_structure?: string | null
          price?: number | null
          purchase_disclaimer?: string | null
          refund_policy?: string | null
          renewal_date?: string | null
          required_agreement_template_id?: string | null
          requires_agreement?: boolean | null
          rescheduling_policy?: string | null
          session_length_minutes?: number | null
          sessions_included?: number | null
          short_description?: string | null
          status?: string
          stripe_payment_link?: string | null
          stripe_price_id?: string | null
          stripe_product_id?: string | null
          success_url?: string | null
          taxes_included?: boolean | null
          template_source_id?: string | null
          term_duration?: number | null
          term_duration_unit?: string | null
          term_end_date?: string | null
          term_start_date?: string | null
          transferability_policy?: string | null
          updated_at?: string
          version?: number
        }
        Update: {
          access_length?: string | null
          admin_notes?: string | null
          agreement_before_service?: boolean
          agreement_required?: boolean
          amount_due_today?: number | null
          archived?: boolean
          archived_at?: string | null
          archived_by?: string | null
          billing_day?: number | null
          cancel_url?: string | null
          cancellation_policy?: string | null
          cancellation_window?: string | null
          checkout_url?: string | null
          commitment_end_date?: string | null
          commitment_start_date?: string | null
          commitment_term_length?: string | null
          created_at?: string
          currency?: string | null
          default_agreement_template_id?: string | null
          delivery_assets?: Json
          delivery_notes?: string | null
          deposit_amount?: number | null
          description?: string | null
          excluded_features?: string[] | null
          expiration_date?: string | null
          final_payment_date?: string | null
          full_payable_amount?: number | null
          gym_access_note?: string | null
          id?: string
          included_features?: string[] | null
          installment_amount?: number | null
          installment_due_day?: number | null
          installment_frequency?: string | null
          is_fixed_term_commitment?: boolean | null
          is_member_facing?: boolean
          is_recurring?: boolean | null
          is_template?: boolean
          last_edited_at?: string | null
          late_arrival_policy?: string | null
          late_failed_policy?: string | null
          location?: string | null
          member_tier_label?: string | null
          minimum_commitment_length?: string | null
          name?: string
          no_show_policy?: string | null
          notes?: string | null
          number_of_payments?: number | null
          offer_type?: string | null
          package_expiry_date?: string | null
          payment_amount?: number | null
          payment_frequency?: string | null
          payment_processing_note?: string | null
          payment_start_date?: string | null
          payment_structure?: string | null
          price?: number | null
          purchase_disclaimer?: string | null
          refund_policy?: string | null
          renewal_date?: string | null
          required_agreement_template_id?: string | null
          requires_agreement?: boolean | null
          rescheduling_policy?: string | null
          session_length_minutes?: number | null
          sessions_included?: number | null
          short_description?: string | null
          status?: string
          stripe_payment_link?: string | null
          stripe_price_id?: string | null
          stripe_product_id?: string | null
          success_url?: string | null
          taxes_included?: boolean | null
          template_source_id?: string | null
          term_duration?: number | null
          term_duration_unit?: string | null
          term_end_date?: string | null
          term_start_date?: string | null
          transferability_policy?: string | null
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "offers_default_agreement_template_id_fkey"
            columns: ["default_agreement_template_id"]
            isOneToOne: false
            referencedRelation: "agreement_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      pl_blocks: {
        Row: {
          archived: boolean
          archived_at: string | null
          archived_by: string | null
          client_id: string
          client_visible: boolean
          coach_notes: string | null
          completed_at: string | null
          completion_method: string | null
          created_at: string
          created_by: string | null
          end_date: string | null
          est_minutes_per_workout: number | null
          goal: string | null
          id: string
          last_scheduled_at: string | null
          last_scheduled_availability: string[] | null
          name: string
          prep_id: string | null
          sort_order: number
          source_template_id: string | null
          start_date: string | null
          status: string
          training_focus: string | null
          updated_at: string
          warmup_protocol_id: string | null
          week_duration_days: number
          week_start_index: number | null
          weeks: number
        }
        Insert: {
          archived?: boolean
          archived_at?: string | null
          archived_by?: string | null
          client_id: string
          client_visible?: boolean
          coach_notes?: string | null
          completed_at?: string | null
          completion_method?: string | null
          created_at?: string
          created_by?: string | null
          end_date?: string | null
          est_minutes_per_workout?: number | null
          goal?: string | null
          id?: string
          last_scheduled_at?: string | null
          last_scheduled_availability?: string[] | null
          name: string
          prep_id?: string | null
          sort_order?: number
          source_template_id?: string | null
          start_date?: string | null
          status?: string
          training_focus?: string | null
          updated_at?: string
          warmup_protocol_id?: string | null
          week_duration_days?: number
          week_start_index?: number | null
          weeks?: number
        }
        Update: {
          archived?: boolean
          archived_at?: string | null
          archived_by?: string | null
          client_id?: string
          client_visible?: boolean
          coach_notes?: string | null
          completed_at?: string | null
          completion_method?: string | null
          created_at?: string
          created_by?: string | null
          end_date?: string | null
          est_minutes_per_workout?: number | null
          goal?: string | null
          id?: string
          last_scheduled_at?: string | null
          last_scheduled_availability?: string[] | null
          name?: string
          prep_id?: string | null
          sort_order?: number
          source_template_id?: string | null
          start_date?: string | null
          status?: string
          training_focus?: string | null
          updated_at?: string
          warmup_protocol_id?: string | null
          week_duration_days?: number
          week_start_index?: number | null
          weeks?: number
        }
        Relationships: [
          {
            foreignKeyName: "pl_blocks_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pl_blocks_prep_id_fkey"
            columns: ["prep_id"]
            isOneToOne: false
            referencedRelation: "pl_preps"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pl_blocks_source_template_id_fkey"
            columns: ["source_template_id"]
            isOneToOne: false
            referencedRelation: "pl_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pl_blocks_warmup_protocol_id_fkey"
            columns: ["warmup_protocol_id"]
            isOneToOne: false
            referencedRelation: "warmup_protocols"
            referencedColumns: ["id"]
          },
        ]
      }
      pl_client_maxes: {
        Row: {
          active: boolean
          block_id: string | null
          client_id: string
          created_at: string
          estimated_1rm: number | null
          exercise_id: string | null
          id: string
          lift: string
          manual_override: boolean
          notes: string | null
          one_rm: number | null
          rounding_mode: string
          rounding_step: number | null
          source: string
          source_exercise_id: string | null
          source_lift: string | null
          tested_at: string | null
          training_max: number | null
          unit: string
          updated_at: string
          variation_modifier: number | null
        }
        Insert: {
          active?: boolean
          block_id?: string | null
          client_id: string
          created_at?: string
          estimated_1rm?: number | null
          exercise_id?: string | null
          id?: string
          lift: string
          manual_override?: boolean
          notes?: string | null
          one_rm?: number | null
          rounding_mode?: string
          rounding_step?: number | null
          source?: string
          source_exercise_id?: string | null
          source_lift?: string | null
          tested_at?: string | null
          training_max?: number | null
          unit?: string
          updated_at?: string
          variation_modifier?: number | null
        }
        Update: {
          active?: boolean
          block_id?: string | null
          client_id?: string
          created_at?: string
          estimated_1rm?: number | null
          exercise_id?: string | null
          id?: string
          lift?: string
          manual_override?: boolean
          notes?: string | null
          one_rm?: number | null
          rounding_mode?: string
          rounding_step?: number | null
          source?: string
          source_exercise_id?: string | null
          source_lift?: string | null
          tested_at?: string | null
          training_max?: number | null
          unit?: string
          updated_at?: string
          variation_modifier?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "pl_client_maxes_block_id_fkey"
            columns: ["block_id"]
            isOneToOne: false
            referencedRelation: "pl_blocks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pl_client_maxes_exercise_id_fkey"
            columns: ["exercise_id"]
            isOneToOne: false
            referencedRelation: "exercises"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pl_client_maxes_source_exercise_id_fkey"
            columns: ["source_exercise_id"]
            isOneToOne: false
            referencedRelation: "exercises"
            referencedColumns: ["id"]
          },
        ]
      }
      pl_day_completions: {
        Row: {
          actual_duration_min: number | null
          client_id: string
          client_notes: string | null
          completed_at: string | null
          completion_method: string | null
          created_at: string
          day_id: string
          id: string
          in_progress_at: string | null
          started_at: string | null
          updated_at: string
        }
        Insert: {
          actual_duration_min?: number | null
          client_id: string
          client_notes?: string | null
          completed_at?: string | null
          completion_method?: string | null
          created_at?: string
          day_id: string
          id?: string
          in_progress_at?: string | null
          started_at?: string | null
          updated_at?: string
        }
        Update: {
          actual_duration_min?: number | null
          client_id?: string
          client_notes?: string | null
          completed_at?: string | null
          completion_method?: string | null
          created_at?: string
          day_id?: string
          id?: string
          in_progress_at?: string | null
          started_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pl_day_completions_day_id_fkey"
            columns: ["day_id"]
            isOneToOne: false
            referencedRelation: "pl_days"
            referencedColumns: ["id"]
          },
        ]
      }
      pl_days: {
        Row: {
          created_at: string
          day_index: number
          duration_estimate_min: number | null
          duration_override_min: number | null
          duration_source: string
          focus: string | null
          id: string
          is_custom: boolean
          notes: string | null
          schedule_locked: boolean
          schedule_source: string | null
          scheduled_date: string | null
          source_day_id: string | null
          title: string | null
          updated_at: string
          warmup_mode: string
          warmup_protocol_id: string | null
          week_id: string
        }
        Insert: {
          created_at?: string
          day_index: number
          duration_estimate_min?: number | null
          duration_override_min?: number | null
          duration_source?: string
          focus?: string | null
          id?: string
          is_custom?: boolean
          notes?: string | null
          schedule_locked?: boolean
          schedule_source?: string | null
          scheduled_date?: string | null
          source_day_id?: string | null
          title?: string | null
          updated_at?: string
          warmup_mode?: string
          warmup_protocol_id?: string | null
          week_id: string
        }
        Update: {
          created_at?: string
          day_index?: number
          duration_estimate_min?: number | null
          duration_override_min?: number | null
          duration_source?: string
          focus?: string | null
          id?: string
          is_custom?: boolean
          notes?: string | null
          schedule_locked?: boolean
          schedule_source?: string | null
          scheduled_date?: string | null
          source_day_id?: string | null
          title?: string | null
          updated_at?: string
          warmup_mode?: string
          warmup_protocol_id?: string | null
          week_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pl_days_source_day_id_fkey"
            columns: ["source_day_id"]
            isOneToOne: false
            referencedRelation: "pl_days"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pl_days_warmup_protocol_id_fkey"
            columns: ["warmup_protocol_id"]
            isOneToOne: false
            referencedRelation: "warmup_protocols"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pl_days_week_id_fkey"
            columns: ["week_id"]
            isOneToOne: false
            referencedRelation: "pl_weeks"
            referencedColumns: ["id"]
          },
        ]
      }
      pl_exercise_notes: {
        Row: {
          client_id: string
          coach_seen_at: string | null
          content: string
          created_at: string
          day_id: string
          exercise_id: string | null
          exercise_name: string
          id: string
          row_id: string | null
          status: string
          updated_at: string
        }
        Insert: {
          client_id: string
          coach_seen_at?: string | null
          content: string
          created_at?: string
          day_id: string
          exercise_id?: string | null
          exercise_name: string
          id?: string
          row_id?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          client_id?: string
          coach_seen_at?: string | null
          content?: string
          created_at?: string
          day_id?: string
          exercise_id?: string | null
          exercise_name?: string
          id?: string
          row_id?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pl_exercise_notes_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pl_exercise_notes_day_id_fkey"
            columns: ["day_id"]
            isOneToOne: false
            referencedRelation: "pl_days"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pl_exercise_notes_exercise_id_fkey"
            columns: ["exercise_id"]
            isOneToOne: false
            referencedRelation: "exercises"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pl_exercise_notes_row_id_fkey"
            columns: ["row_id"]
            isOneToOne: false
            referencedRelation: "pl_exercise_rows"
            referencedColumns: ["id"]
          },
        ]
      }
      pl_exercise_rows: {
        Row: {
          basis_row_id: string | null
          created_at: string
          day_id: string
          estimated_seconds: number | null
          estimated_seconds_override: number | null
          exercise_id: string | null
          exercise_name_override: string | null
          id: string
          intensity_techniques: string[]
          load_kg: number | null
          load_lb: number | null
          load_unit: string | null
          manual_override: boolean
          notes: string | null
          override_of_pct: number | null
          percentage: number | null
          percentage_basis: string | null
          progression_method: string | null
          reps_text: string | null
          rest_seconds: number | null
          rir: string | null
          rpe: string | null
          sets: number | null
          sort_order: number
          tempo: string | null
          time_profile: string
          updated_at: string
        }
        Insert: {
          basis_row_id?: string | null
          created_at?: string
          day_id: string
          estimated_seconds?: number | null
          estimated_seconds_override?: number | null
          exercise_id?: string | null
          exercise_name_override?: string | null
          id?: string
          intensity_techniques?: string[]
          load_kg?: number | null
          load_lb?: number | null
          load_unit?: string | null
          manual_override?: boolean
          notes?: string | null
          override_of_pct?: number | null
          percentage?: number | null
          percentage_basis?: string | null
          progression_method?: string | null
          reps_text?: string | null
          rest_seconds?: number | null
          rir?: string | null
          rpe?: string | null
          sets?: number | null
          sort_order?: number
          tempo?: string | null
          time_profile?: string
          updated_at?: string
        }
        Update: {
          basis_row_id?: string | null
          created_at?: string
          day_id?: string
          estimated_seconds?: number | null
          estimated_seconds_override?: number | null
          exercise_id?: string | null
          exercise_name_override?: string | null
          id?: string
          intensity_techniques?: string[]
          load_kg?: number | null
          load_lb?: number | null
          load_unit?: string | null
          manual_override?: boolean
          notes?: string | null
          override_of_pct?: number | null
          percentage?: number | null
          percentage_basis?: string | null
          progression_method?: string | null
          reps_text?: string | null
          rest_seconds?: number | null
          rir?: string | null
          rpe?: string | null
          sets?: number | null
          sort_order?: number
          tempo?: string | null
          time_profile?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pl_exercise_rows_basis_row_id_fkey"
            columns: ["basis_row_id"]
            isOneToOne: false
            referencedRelation: "pl_exercise_rows"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pl_exercise_rows_day_id_fkey"
            columns: ["day_id"]
            isOneToOne: false
            referencedRelation: "pl_days"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pl_exercise_rows_exercise_id_fkey"
            columns: ["exercise_id"]
            isOneToOne: false
            referencedRelation: "exercises"
            referencedColumns: ["id"]
          },
        ]
      }
      pl_preps: {
        Row: {
          archived: boolean
          archived_at: string | null
          archived_by: string | null
          client_id: string
          client_visible: boolean
          coach_notes: string | null
          created_at: string
          created_by: string | null
          current_focus: string | null
          division: string | null
          end_date: string | null
          event_date: string | null
          event_location: string | null
          event_name: string | null
          federation: string | null
          goal_type: string
          id: string
          source_template_id: string | null
          start_date: string | null
          status: string
          title: string
          total_weeks: number | null
          updated_at: string
          weight_class: string | null
        }
        Insert: {
          archived?: boolean
          archived_at?: string | null
          archived_by?: string | null
          client_id: string
          client_visible?: boolean
          coach_notes?: string | null
          created_at?: string
          created_by?: string | null
          current_focus?: string | null
          division?: string | null
          end_date?: string | null
          event_date?: string | null
          event_location?: string | null
          event_name?: string | null
          federation?: string | null
          goal_type?: string
          id?: string
          source_template_id?: string | null
          start_date?: string | null
          status?: string
          title: string
          total_weeks?: number | null
          updated_at?: string
          weight_class?: string | null
        }
        Update: {
          archived?: boolean
          archived_at?: string | null
          archived_by?: string | null
          client_id?: string
          client_visible?: boolean
          coach_notes?: string | null
          created_at?: string
          created_by?: string | null
          current_focus?: string | null
          division?: string | null
          end_date?: string | null
          event_date?: string | null
          event_location?: string | null
          event_name?: string | null
          federation?: string | null
          goal_type?: string
          id?: string
          source_template_id?: string | null
          start_date?: string | null
          status?: string
          title?: string
          total_weeks?: number | null
          updated_at?: string
          weight_class?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pl_preps_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pl_preps_source_template_id_fkey"
            columns: ["source_template_id"]
            isOneToOne: false
            referencedRelation: "pl_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      pl_row_results: {
        Row: {
          actual_load: number | null
          actual_load_unit: string | null
          actual_reps: number | null
          actual_rir: string | null
          actual_rpe: string | null
          client_id: string
          completed_at: string | null
          created_at: string
          id: string
          notes: string | null
          row_id: string
          set_index: number
          updated_at: string
          video_url: string | null
        }
        Insert: {
          actual_load?: number | null
          actual_load_unit?: string | null
          actual_reps?: number | null
          actual_rir?: string | null
          actual_rpe?: string | null
          client_id: string
          completed_at?: string | null
          created_at?: string
          id?: string
          notes?: string | null
          row_id: string
          set_index: number
          updated_at?: string
          video_url?: string | null
        }
        Update: {
          actual_load?: number | null
          actual_load_unit?: string | null
          actual_reps?: number | null
          actual_rir?: string | null
          actual_rpe?: string | null
          client_id?: string
          completed_at?: string | null
          created_at?: string
          id?: string
          notes?: string | null
          row_id?: string
          set_index?: number
          updated_at?: string
          video_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pl_row_results_row_id_fkey"
            columns: ["row_id"]
            isOneToOne: false
            referencedRelation: "pl_exercise_rows"
            referencedColumns: ["id"]
          },
        ]
      }
      pl_templates: {
        Row: {
          archived: boolean
          archived_at: string | null
          archived_by: string | null
          created_at: string
          created_by: string | null
          days_per_week: number | null
          est_duration_min: number | null
          goal: string | null
          id: string
          name: string
          notes: string | null
          payload: Json
          status: string
          tags: string[]
          template_type: string
          training_focus: string | null
          training_style: string
          updated_at: string
          weeks: number | null
        }
        Insert: {
          archived?: boolean
          archived_at?: string | null
          archived_by?: string | null
          created_at?: string
          created_by?: string | null
          days_per_week?: number | null
          est_duration_min?: number | null
          goal?: string | null
          id?: string
          name: string
          notes?: string | null
          payload?: Json
          status?: string
          tags?: string[]
          template_type?: string
          training_focus?: string | null
          training_style?: string
          updated_at?: string
          weeks?: number | null
        }
        Update: {
          archived?: boolean
          archived_at?: string | null
          archived_by?: string | null
          created_at?: string
          created_by?: string | null
          days_per_week?: number | null
          est_duration_min?: number | null
          goal?: string | null
          id?: string
          name?: string
          notes?: string | null
          payload?: Json
          status?: string
          tags?: string[]
          template_type?: string
          training_focus?: string | null
          training_style?: string
          updated_at?: string
          weeks?: number | null
        }
        Relationships: []
      }
      pl_weeks: {
        Row: {
          block_id: string
          created_at: string
          date_source: string
          end_date: string | null
          est_minutes: number | null
          id: string
          manual_completed_at: string | null
          manual_completed_by: string | null
          manually_completed: boolean
          notes: string | null
          start_date: string | null
          status: string
          training_days: string[]
          updated_at: string
          week_index: number
        }
        Insert: {
          block_id: string
          created_at?: string
          date_source?: string
          end_date?: string | null
          est_minutes?: number | null
          id?: string
          manual_completed_at?: string | null
          manual_completed_by?: string | null
          manually_completed?: boolean
          notes?: string | null
          start_date?: string | null
          status?: string
          training_days?: string[]
          updated_at?: string
          week_index: number
        }
        Update: {
          block_id?: string
          created_at?: string
          date_source?: string
          end_date?: string | null
          est_minutes?: number | null
          id?: string
          manual_completed_at?: string | null
          manual_completed_by?: string | null
          manually_completed?: boolean
          notes?: string | null
          start_date?: string | null
          status?: string
          training_days?: string[]
          updated_at?: string
          week_index?: number
        }
        Relationships: [
          {
            foreignKeyName: "pl_weeks_block_id_fkey"
            columns: ["block_id"]
            isOneToOne: false
            referencedRelation: "pl_blocks"
            referencedColumns: ["id"]
          },
        ]
      }
      processed_stripe_events: {
        Row: {
          created_at: string
          event_id: string
          event_type: string
          processed_at: string
        }
        Insert: {
          created_at?: string
          event_id: string
          event_type: string
          processed_at?: string
        }
        Update: {
          created_at?: string
          event_id?: string
          event_type?: string
          processed_at?: string
        }
        Relationships: []
      }
      product_access_grants: {
        Row: {
          access_level_keys: string[]
          account_type_granted: string
          created_at: string
          id: string
          included_plan_ids: string[]
          is_subscription: boolean
          offer_id: string
          updated_at: string
        }
        Insert: {
          access_level_keys?: string[]
          account_type_granted?: string
          created_at?: string
          id?: string
          included_plan_ids?: string[]
          is_subscription?: boolean
          offer_id: string
          updated_at?: string
        }
        Update: {
          access_level_keys?: string[]
          account_type_granted?: string
          created_at?: string
          id?: string
          included_plan_ids?: string[]
          is_subscription?: boolean
          offer_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_access_grants_offer_id_fkey"
            columns: ["offer_id"]
            isOneToOne: true
            referencedRelation: "offers"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          email: string | null
          full_name: string | null
          id: string
          phone: string | null
          profile_picture_source: string | null
          profile_picture_updated_at: string | null
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id: string
          phone?: string | null
          profile_picture_source?: string | null
          profile_picture_updated_at?: string | null
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          phone?: string | null
          profile_picture_source?: string | null
          profile_picture_updated_at?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      progress_metrics: {
        Row: {
          active_minutes: number | null
          bodyweight: number | null
          bodyweight_unit: string
          calories_burned: number | null
          client_id: string
          created_at: string
          created_by: string | null
          entry_date: string
          id: string
          notes: string | null
          resting_heart_rate: number | null
          sleep_hours: number | null
          source: string
          steps: number | null
          updated_at: string
        }
        Insert: {
          active_minutes?: number | null
          bodyweight?: number | null
          bodyweight_unit?: string
          calories_burned?: number | null
          client_id: string
          created_at?: string
          created_by?: string | null
          entry_date?: string
          id?: string
          notes?: string | null
          resting_heart_rate?: number | null
          sleep_hours?: number | null
          source?: string
          steps?: number | null
          updated_at?: string
        }
        Update: {
          active_minutes?: number | null
          bodyweight?: number | null
          bodyweight_unit?: string
          calories_burned?: number | null
          client_id?: string
          created_at?: string
          created_by?: string | null
          entry_date?: string
          id?: string
          notes?: string | null
          resting_heart_rate?: number | null
          sleep_hours?: number | null
          source?: string
          steps?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      pt_sessions: {
        Row: {
          client_id: string
          client_visible_notes: boolean
          confirmation_sent_at: string | null
          created_at: string
          custom_type: string | null
          end_time: string
          ends_at: string | null
          id: string
          location: string
          notes: string | null
          reminder_1h_sent_at: string | null
          reminder_24h_sent_at: string | null
          reminders_enabled: boolean
          send_confirmation_email: boolean
          session_date: string
          session_type: string
          start_time: string
          starts_at: string | null
          status: string
          timezone: string
          title: string
          updated_at: string
          visible_to_client: boolean
        }
        Insert: {
          client_id: string
          client_visible_notes?: boolean
          confirmation_sent_at?: string | null
          created_at?: string
          custom_type?: string | null
          end_time: string
          ends_at?: string | null
          id?: string
          location?: string
          notes?: string | null
          reminder_1h_sent_at?: string | null
          reminder_24h_sent_at?: string | null
          reminders_enabled?: boolean
          send_confirmation_email?: boolean
          session_date: string
          session_type?: string
          start_time: string
          starts_at?: string | null
          status?: string
          timezone?: string
          title: string
          updated_at?: string
          visible_to_client?: boolean
        }
        Update: {
          client_id?: string
          client_visible_notes?: boolean
          confirmation_sent_at?: string | null
          created_at?: string
          custom_type?: string | null
          end_time?: string
          ends_at?: string | null
          id?: string
          location?: string
          notes?: string | null
          reminder_1h_sent_at?: string | null
          reminder_24h_sent_at?: string | null
          reminders_enabled?: boolean
          send_confirmation_email?: boolean
          session_date?: string
          session_type?: string
          start_time?: string
          starts_at?: string | null
          status?: string
          timezone?: string
          title?: string
          updated_at?: string
          visible_to_client?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "pt_sessions_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_records: {
        Row: {
          admin_notes: string | null
          agreement_block_override: boolean
          agreement_block_override_at: string | null
          agreement_block_override_by: string | null
          agreement_block_override_reason: string | null
          agreement_link: string | null
          agreement_signed_at_purchase: boolean | null
          agreement_signed_date: string | null
          agreement_version: string | null
          amount_due_today: number | null
          amount_paid: number | null
          assigned_at: string
          assigned_by: string | null
          cancellation_policy: string | null
          client_id: string
          confirmation_email_sent_at: string | null
          created_at: string
          currency: string | null
          deposit_amount: number | null
          excluded_features: string[] | null
          full_description: string | null
          full_payable_amount: number | null
          id: string
          in_person_policy: string | null
          included_features: string[] | null
          installment_amount: number | null
          is_fixed_term_commitment: boolean | null
          is_recurring: boolean | null
          last_payment_update_at: string | null
          last_payment_update_source: string | null
          location: string | null
          number_of_payments: number | null
          offer_id: string | null
          offer_name: string
          offer_type: string | null
          offer_version: number | null
          package_expiry_date: string | null
          package_tracking_enabled: boolean | null
          paid_at: string | null
          payment_frequency: string | null
          payment_status: string
          payment_structure: string | null
          purchase_disclaimer: string | null
          purchased_at: string
          refund_policy: string | null
          service_status: string
          session_length_minutes: number | null
          sessions_booked: number | null
          sessions_cancelled: number | null
          sessions_completed: number | null
          sessions_missed: number | null
          sessions_purchased: number | null
          sessions_used: number | null
          short_description: string | null
          status: string
          stripe_checkout_session_id: string | null
          stripe_customer_id: string | null
          stripe_payment_intent_id: string | null
          stripe_payment_link: string | null
          stripe_price_id: string | null
          stripe_product_id: string | null
          stripe_receipt_url: string | null
          stripe_subscription_id: string | null
          term_duration_text: string | null
          term_end_date: string | null
          term_start_date: string | null
          terms_accepted: boolean | null
          terms_accepted_at: string | null
          terms_accepted_client_email: string | null
          terms_accepted_client_name: string | null
          timezone: string | null
          updated_at: string
        }
        Insert: {
          admin_notes?: string | null
          agreement_block_override?: boolean
          agreement_block_override_at?: string | null
          agreement_block_override_by?: string | null
          agreement_block_override_reason?: string | null
          agreement_link?: string | null
          agreement_signed_at_purchase?: boolean | null
          agreement_signed_date?: string | null
          agreement_version?: string | null
          amount_due_today?: number | null
          amount_paid?: number | null
          assigned_at?: string
          assigned_by?: string | null
          cancellation_policy?: string | null
          client_id: string
          confirmation_email_sent_at?: string | null
          created_at?: string
          currency?: string | null
          deposit_amount?: number | null
          excluded_features?: string[] | null
          full_description?: string | null
          full_payable_amount?: number | null
          id?: string
          in_person_policy?: string | null
          included_features?: string[] | null
          installment_amount?: number | null
          is_fixed_term_commitment?: boolean | null
          is_recurring?: boolean | null
          last_payment_update_at?: string | null
          last_payment_update_source?: string | null
          location?: string | null
          number_of_payments?: number | null
          offer_id?: string | null
          offer_name: string
          offer_type?: string | null
          offer_version?: number | null
          package_expiry_date?: string | null
          package_tracking_enabled?: boolean | null
          paid_at?: string | null
          payment_frequency?: string | null
          payment_status?: string
          payment_structure?: string | null
          purchase_disclaimer?: string | null
          purchased_at?: string
          refund_policy?: string | null
          service_status?: string
          session_length_minutes?: number | null
          sessions_booked?: number | null
          sessions_cancelled?: number | null
          sessions_completed?: number | null
          sessions_missed?: number | null
          sessions_purchased?: number | null
          sessions_used?: number | null
          short_description?: string | null
          status?: string
          stripe_checkout_session_id?: string | null
          stripe_customer_id?: string | null
          stripe_payment_intent_id?: string | null
          stripe_payment_link?: string | null
          stripe_price_id?: string | null
          stripe_product_id?: string | null
          stripe_receipt_url?: string | null
          stripe_subscription_id?: string | null
          term_duration_text?: string | null
          term_end_date?: string | null
          term_start_date?: string | null
          terms_accepted?: boolean | null
          terms_accepted_at?: string | null
          terms_accepted_client_email?: string | null
          terms_accepted_client_name?: string | null
          timezone?: string | null
          updated_at?: string
        }
        Update: {
          admin_notes?: string | null
          agreement_block_override?: boolean
          agreement_block_override_at?: string | null
          agreement_block_override_by?: string | null
          agreement_block_override_reason?: string | null
          agreement_link?: string | null
          agreement_signed_at_purchase?: boolean | null
          agreement_signed_date?: string | null
          agreement_version?: string | null
          amount_due_today?: number | null
          amount_paid?: number | null
          assigned_at?: string
          assigned_by?: string | null
          cancellation_policy?: string | null
          client_id?: string
          confirmation_email_sent_at?: string | null
          created_at?: string
          currency?: string | null
          deposit_amount?: number | null
          excluded_features?: string[] | null
          full_description?: string | null
          full_payable_amount?: number | null
          id?: string
          in_person_policy?: string | null
          included_features?: string[] | null
          installment_amount?: number | null
          is_fixed_term_commitment?: boolean | null
          is_recurring?: boolean | null
          last_payment_update_at?: string | null
          last_payment_update_source?: string | null
          location?: string | null
          number_of_payments?: number | null
          offer_id?: string | null
          offer_name?: string
          offer_type?: string | null
          offer_version?: number | null
          package_expiry_date?: string | null
          package_tracking_enabled?: boolean | null
          paid_at?: string | null
          payment_frequency?: string | null
          payment_status?: string
          payment_structure?: string | null
          purchase_disclaimer?: string | null
          purchased_at?: string
          refund_policy?: string | null
          service_status?: string
          session_length_minutes?: number | null
          sessions_booked?: number | null
          sessions_cancelled?: number | null
          sessions_completed?: number | null
          sessions_missed?: number | null
          sessions_purchased?: number | null
          sessions_used?: number | null
          short_description?: string | null
          status?: string
          stripe_checkout_session_id?: string | null
          stripe_customer_id?: string | null
          stripe_payment_intent_id?: string | null
          stripe_payment_link?: string | null
          stripe_price_id?: string | null
          stripe_product_id?: string | null
          stripe_receipt_url?: string | null
          stripe_subscription_id?: string | null
          term_duration_text?: string | null
          term_end_date?: string | null
          term_start_date?: string | null
          terms_accepted?: boolean | null
          terms_accepted_at?: string | null
          terms_accepted_client_email?: string | null
          terms_accepted_client_name?: string | null
          timezone?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      recipe_client_access: {
        Row: {
          client_id: string
          created_at: string
          id: string
          recipe_id: string
        }
        Insert: {
          client_id: string
          created_at?: string
          id?: string
          recipe_id: string
        }
        Update: {
          client_id?: string
          created_at?: string
          id?: string
          recipe_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "recipe_client_access_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recipe_client_access_recipe_id_fkey"
            columns: ["recipe_id"]
            isOneToOne: false
            referencedRelation: "recipes"
            referencedColumns: ["id"]
          },
        ]
      }
      recipe_notifications: {
        Row: {
          created_at: string
          id: string
          recipe_id: string
          seen_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          recipe_id: string
          seen_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          recipe_id?: string
          seen_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "recipe_notifications_recipe_id_fkey"
            columns: ["recipe_id"]
            isOneToOne: false
            referencedRelation: "recipes"
            referencedColumns: ["id"]
          },
        ]
      }
      recipes: {
        Row: {
          access_scope: string
          author_id: string | null
          body: string
          category: string
          created_at: string
          id: string
          published_at: string | null
          status: string
          tags: string[]
          title: string
          updated_at: string
          video_url: string | null
        }
        Insert: {
          access_scope?: string
          author_id?: string | null
          body?: string
          category?: string
          created_at?: string
          id?: string
          published_at?: string | null
          status?: string
          tags?: string[]
          title: string
          updated_at?: string
          video_url?: string | null
        }
        Update: {
          access_scope?: string
          author_id?: string | null
          body?: string
          category?: string
          created_at?: string
          id?: string
          published_at?: string | null
          status?: string
          tags?: string[]
          title?: string
          updated_at?: string
          video_url?: string | null
        }
        Relationships: []
      }
      resource_comments: {
        Row: {
          body: string
          created_at: string
          id: string
          resource_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          body: string
          created_at?: string
          id?: string
          resource_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          body?: string
          created_at?: string
          id?: string
          resource_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "resource_comments_resource_id_fkey"
            columns: ["resource_id"]
            isOneToOne: false
            referencedRelation: "resources"
            referencedColumns: ["id"]
          },
        ]
      }
      resource_folders: {
        Row: {
          color: string | null
          created_at: string
          created_by: string | null
          icon: string | null
          id: string
          name: string
          parent_id: string | null
          sort_order: number
          updated_at: string
        }
        Insert: {
          color?: string | null
          created_at?: string
          created_by?: string | null
          icon?: string | null
          id?: string
          name: string
          parent_id?: string | null
          sort_order?: number
          updated_at?: string
        }
        Update: {
          color?: string | null
          created_at?: string
          created_by?: string | null
          icon?: string | null
          id?: string
          name?: string
          parent_id?: string | null
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "resource_folders_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "resource_folders"
            referencedColumns: ["id"]
          },
        ]
      }
      resources: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          external_url: string | null
          file_size: number | null
          folder_id: string | null
          id: string
          mime_type: string | null
          name: string
          search_text: unknown
          storage_path: string | null
          tags: string[]
          thumbnail_path: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          external_url?: string | null
          file_size?: number | null
          folder_id?: string | null
          id?: string
          mime_type?: string | null
          name: string
          search_text?: unknown
          storage_path?: string | null
          tags?: string[]
          thumbnail_path?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          external_url?: string | null
          file_size?: number | null
          folder_id?: string | null
          id?: string
          mime_type?: string | null
          name?: string
          search_text?: unknown
          storage_path?: string | null
          tags?: string[]
          thumbnail_path?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "resources_folder_id_fkey"
            columns: ["folder_id"]
            isOneToOne: false
            referencedRelation: "resource_folders"
            referencedColumns: ["id"]
          },
        ]
      }
      sales_pages: {
        Row: {
          created_at: string
          draft_notes: string | null
          draft_payload: Json | null
          draft_reviewed_at: string | null
          draft_reviewed_by: string | null
          draft_status: Database["public"]["Enums"]["review_status"] | null
          draft_submitted_at: string | null
          draft_submitted_by: string | null
          hero_headline: string
          hero_image_url: string | null
          hero_subheadline: string
          page_key: string
          primary_cta_kind: string
          primary_cta_label: string
          primary_cta_url: string | null
          promo_message: string | null
          published: boolean
          secondary_cta_href: string | null
          secondary_cta_label: string | null
          sections: Json
          testimonials: Json
          updated_at: string
          updated_by: string | null
          visuals: Json
        }
        Insert: {
          created_at?: string
          draft_notes?: string | null
          draft_payload?: Json | null
          draft_reviewed_at?: string | null
          draft_reviewed_by?: string | null
          draft_status?: Database["public"]["Enums"]["review_status"] | null
          draft_submitted_at?: string | null
          draft_submitted_by?: string | null
          hero_headline?: string
          hero_image_url?: string | null
          hero_subheadline?: string
          page_key: string
          primary_cta_kind?: string
          primary_cta_label?: string
          primary_cta_url?: string | null
          promo_message?: string | null
          published?: boolean
          secondary_cta_href?: string | null
          secondary_cta_label?: string | null
          sections?: Json
          testimonials?: Json
          updated_at?: string
          updated_by?: string | null
          visuals?: Json
        }
        Update: {
          created_at?: string
          draft_notes?: string | null
          draft_payload?: Json | null
          draft_reviewed_at?: string | null
          draft_reviewed_by?: string | null
          draft_status?: Database["public"]["Enums"]["review_status"] | null
          draft_submitted_at?: string | null
          draft_submitted_by?: string | null
          hero_headline?: string
          hero_image_url?: string | null
          hero_subheadline?: string
          page_key?: string
          primary_cta_kind?: string
          primary_cta_label?: string
          primary_cta_url?: string | null
          promo_message?: string | null
          published?: boolean
          secondary_cta_href?: string | null
          secondary_cta_label?: string | null
          sections?: Json
          testimonials?: Json
          updated_at?: string
          updated_by?: string | null
          visuals?: Json
        }
        Relationships: []
      }
      setup_prompt_dismissals: {
        Row: {
          created_at: string
          id: string
          prompt_id: string
          remind_after: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          prompt_id: string
          remind_after?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          prompt_id?: string
          remind_after?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "setup_prompt_dismissals_prompt_id_fkey"
            columns: ["prompt_id"]
            isOneToOne: false
            referencedRelation: "setup_prompts"
            referencedColumns: ["id"]
          },
        ]
      }
      setup_prompts: {
        Row: {
          android_steps: Json
          audience_scope: string
          body: string | null
          created_at: string
          enabled: boolean
          id: string
          ios_steps: Json
          link_label: string | null
          link_url: string | null
          sort_order: number
          title: string
          updated_at: string
          video_embed_url: string | null
          video_url: string | null
        }
        Insert: {
          android_steps?: Json
          audience_scope?: string
          body?: string | null
          created_at?: string
          enabled?: boolean
          id?: string
          ios_steps?: Json
          link_label?: string | null
          link_url?: string | null
          sort_order?: number
          title: string
          updated_at?: string
          video_embed_url?: string | null
          video_url?: string | null
        }
        Update: {
          android_steps?: Json
          audience_scope?: string
          body?: string | null
          created_at?: string
          enabled?: boolean
          id?: string
          ios_steps?: Json
          link_label?: string | null
          link_url?: string | null
          sort_order?: number
          title?: string
          updated_at?: string
          video_embed_url?: string | null
          video_url?: string | null
        }
        Relationships: []
      }
      signnow_settings: {
        Row: {
          access_token_expires_at: string | null
          access_token_status: string
          account_email: string | null
          api_basic_auth_token: string | null
          api_client_id: string | null
          app_mode_note: string | null
          auto_reminders_enabled: boolean
          created_at: string
          default_template_id: string | null
          id: string
          last_error: string | null
          last_synced_at: string | null
          last_test_at: string | null
          last_test_result: string | null
          notes: string | null
          redirect_uri: string | null
          refresh_token_status: string
          reminder_intervals_days: number[]
          signnow_dashboard_url: string | null
          singleton: boolean
          status: string
          updated_at: string
        }
        Insert: {
          access_token_expires_at?: string | null
          access_token_status?: string
          account_email?: string | null
          api_basic_auth_token?: string | null
          api_client_id?: string | null
          app_mode_note?: string | null
          auto_reminders_enabled?: boolean
          created_at?: string
          default_template_id?: string | null
          id?: string
          last_error?: string | null
          last_synced_at?: string | null
          last_test_at?: string | null
          last_test_result?: string | null
          notes?: string | null
          redirect_uri?: string | null
          refresh_token_status?: string
          reminder_intervals_days?: number[]
          signnow_dashboard_url?: string | null
          singleton?: boolean
          status?: string
          updated_at?: string
        }
        Update: {
          access_token_expires_at?: string | null
          access_token_status?: string
          account_email?: string | null
          api_basic_auth_token?: string | null
          api_client_id?: string | null
          app_mode_note?: string | null
          auto_reminders_enabled?: boolean
          created_at?: string
          default_template_id?: string | null
          id?: string
          last_error?: string | null
          last_synced_at?: string | null
          last_test_at?: string | null
          last_test_result?: string | null
          notes?: string | null
          redirect_uri?: string | null
          refresh_token_status?: string
          reminder_intervals_days?: number[]
          signnow_dashboard_url?: string | null
          singleton?: boolean
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      sms_automations: {
        Row: {
          active: boolean
          audience_config: Json
          audience_type: string
          body: string
          category: string
          created_at: string
          created_by: string | null
          delay_minutes: number
          id: string
          internal_note: string | null
          max_per_client_per_day: number
          name: string
          quiet_hours_end: string
          quiet_hours_start: string
          respect_quiet_hours: boolean
          trigger_config: Json
          trigger_type: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          audience_config?: Json
          audience_type?: string
          body: string
          category?: string
          created_at?: string
          created_by?: string | null
          delay_minutes?: number
          id?: string
          internal_note?: string | null
          max_per_client_per_day?: number
          name: string
          quiet_hours_end?: string
          quiet_hours_start?: string
          respect_quiet_hours?: boolean
          trigger_config?: Json
          trigger_type: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          audience_config?: Json
          audience_type?: string
          body?: string
          category?: string
          created_at?: string
          created_by?: string | null
          delay_minutes?: number
          id?: string
          internal_note?: string | null
          max_per_client_per_day?: number
          name?: string
          quiet_hours_end?: string
          quiet_hours_start?: string
          respect_quiet_hours?: boolean
          trigger_config?: Json
          trigger_type?: string
          updated_at?: string
        }
        Relationships: []
      }
      sms_log: {
        Row: {
          app_member_id: string | null
          automation_id: string | null
          automation_trigger: string | null
          body: string
          client_id: string | null
          created_at: string
          error: string | null
          id: string
          kind: string
          message_id: string | null
          reminder_step: number | null
          sender_user_id: string | null
          status: string
          to_phone: string
          twilio_sid: string | null
        }
        Insert: {
          app_member_id?: string | null
          automation_id?: string | null
          automation_trigger?: string | null
          body: string
          client_id?: string | null
          created_at?: string
          error?: string | null
          id?: string
          kind: string
          message_id?: string | null
          reminder_step?: number | null
          sender_user_id?: string | null
          status?: string
          to_phone: string
          twilio_sid?: string | null
        }
        Update: {
          app_member_id?: string | null
          automation_id?: string | null
          automation_trigger?: string | null
          body?: string
          client_id?: string | null
          created_at?: string
          error?: string | null
          id?: string
          kind?: string
          message_id?: string | null
          reminder_step?: number | null
          sender_user_id?: string | null
          status?: string
          to_phone?: string
          twilio_sid?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sms_log_app_member_id_fkey"
            columns: ["app_member_id"]
            isOneToOne: false
            referencedRelation: "app_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sms_log_automation_id_fkey"
            columns: ["automation_id"]
            isOneToOne: false
            referencedRelation: "sms_automations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sms_log_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sms_log_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
        ]
      }
      sms_settings: {
        Row: {
          brand_name: string
          enabled: boolean
          from_phone: string | null
          id: string
          manual_default_template: string
          rate_limit_per_hour: number
          reminder_steps: Json
          singleton: boolean
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          brand_name?: string
          enabled?: boolean
          from_phone?: string | null
          id?: string
          manual_default_template?: string
          rate_limit_per_hour?: number
          reminder_steps?: Json
          singleton?: boolean
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          brand_name?: string
          enabled?: boolean
          from_phone?: string | null
          id?: string
          manual_default_template?: string
          rate_limit_per_hour?: number
          reminder_steps?: Json
          singleton?: boolean
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      staff_invites: {
        Row: {
          created_at: string
          created_by: string | null
          email: string
          first_name: string | null
          id: string
          last_name: string | null
          phone: string | null
          redeemed_at: string | null
          redeemed_user_id: string | null
          role: Database["public"]["Enums"]["app_role"]
          setup_token: string | null
          setup_token_expires_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          email: string
          first_name?: string | null
          id?: string
          last_name?: string | null
          phone?: string | null
          redeemed_at?: string | null
          redeemed_user_id?: string | null
          role: Database["public"]["Enums"]["app_role"]
          setup_token?: string | null
          setup_token_expires_at?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          email?: string
          first_name?: string | null
          id?: string
          last_name?: string | null
          phone?: string | null
          redeemed_at?: string | null
          redeemed_user_id?: string | null
          role?: Database["public"]["Enums"]["app_role"]
          setup_token?: string | null
          setup_token_expires_at?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      suppressed_emails: {
        Row: {
          created_at: string
          email: string
          id: string
          metadata: Json | null
          reason: string
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          metadata?: Json | null
          reason: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          metadata?: Json | null
          reason?: string
        }
        Relationships: []
      }
      tasks: {
        Row: {
          assigned_to: string | null
          assignee_name: string | null
          completed_at: string | null
          completed_by: string | null
          created_at: string
          created_by: string | null
          due_at: string | null
          id: string
          notes: string | null
          position: number
          priority: number
          quadrant: Database["public"]["Enums"]["task_quadrant"]
          scope: string
          status: Database["public"]["Enums"]["task_status"]
          title: string
          updated_at: string
        }
        Insert: {
          assigned_to?: string | null
          assignee_name?: string | null
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          created_by?: string | null
          due_at?: string | null
          id?: string
          notes?: string | null
          position?: number
          priority?: number
          quadrant?: Database["public"]["Enums"]["task_quadrant"]
          scope?: string
          status?: Database["public"]["Enums"]["task_status"]
          title: string
          updated_at?: string
        }
        Update: {
          assigned_to?: string | null
          assignee_name?: string | null
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          created_by?: string | null
          due_at?: string | null
          id?: string
          notes?: string | null
          position?: number
          priority?: number
          quadrant?: Database["public"]["Enums"]["task_quadrant"]
          scope?: string
          status?: Database["public"]["Enums"]["task_status"]
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tasks_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "coaches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_completed_by_fkey"
            columns: ["completed_by"]
            isOneToOne: false
            referencedRelation: "coaches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "coaches"
            referencedColumns: ["id"]
          },
        ]
      }
      training_phases: {
        Row: {
          client_id: string
          created_at: string
          current_week: number | null
          custom_phase_name: string | null
          end_date: string
          ending_soon_days: number
          id: string
          notes: string | null
          phase_type: string
          program_link: string | null
          sort_order: number
          start_date: string
          status: string
          title: string
          training_goal: string | null
          updated_at: string
          visible_to_client: boolean
        }
        Insert: {
          client_id: string
          created_at?: string
          current_week?: number | null
          custom_phase_name?: string | null
          end_date: string
          ending_soon_days?: number
          id?: string
          notes?: string | null
          phase_type: string
          program_link?: string | null
          sort_order?: number
          start_date: string
          status?: string
          title: string
          training_goal?: string | null
          updated_at?: string
          visible_to_client?: boolean
        }
        Update: {
          client_id?: string
          created_at?: string
          current_week?: number | null
          custom_phase_name?: string | null
          end_date?: string
          ending_soon_days?: number
          id?: string
          notes?: string | null
          phase_type?: string
          program_link?: string | null
          sort_order?: number
          start_date?: string
          status?: string
          title?: string
          training_goal?: string | null
          updated_at?: string
          visible_to_client?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "training_phases_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          is_primary: boolean
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_primary?: boolean
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          is_primary?: boolean
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      warmup_assignments: {
        Row: {
          client_id: string | null
          created_at: string
          created_by: string | null
          exercise_id: string | null
          id: string
          pl_block_id: string | null
          pl_day_id: string | null
          protocol_id: string
          scope: string
          updated_at: string
        }
        Insert: {
          client_id?: string | null
          created_at?: string
          created_by?: string | null
          exercise_id?: string | null
          id?: string
          pl_block_id?: string | null
          pl_day_id?: string | null
          protocol_id: string
          scope: string
          updated_at?: string
        }
        Update: {
          client_id?: string | null
          created_at?: string
          created_by?: string | null
          exercise_id?: string | null
          id?: string
          pl_block_id?: string | null
          pl_day_id?: string | null
          protocol_id?: string
          scope?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "warmup_assignments_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "warmup_assignments_exercise_id_fkey"
            columns: ["exercise_id"]
            isOneToOne: false
            referencedRelation: "exercises"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "warmup_assignments_pl_block_id_fkey"
            columns: ["pl_block_id"]
            isOneToOne: false
            referencedRelation: "pl_blocks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "warmup_assignments_pl_day_id_fkey"
            columns: ["pl_day_id"]
            isOneToOne: false
            referencedRelation: "pl_days"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "warmup_assignments_protocol_id_fkey"
            columns: ["protocol_id"]
            isOneToOne: false
            referencedRelation: "warmup_protocols"
            referencedColumns: ["id"]
          },
        ]
      }
      warmup_protocols: {
        Row: {
          archived: boolean
          category: string
          created_at: string
          created_by: string | null
          estimated_minutes: number | null
          id: string
          internal_notes: string | null
          is_default_general: boolean
          is_default_powerlifting: boolean
          name: string
          notes: string | null
          sections: Json
          target_lift: string | null
          updated_at: string
          visible_to_client: boolean
        }
        Insert: {
          archived?: boolean
          category?: string
          created_at?: string
          created_by?: string | null
          estimated_minutes?: number | null
          id?: string
          internal_notes?: string | null
          is_default_general?: boolean
          is_default_powerlifting?: boolean
          name: string
          notes?: string | null
          sections?: Json
          target_lift?: string | null
          updated_at?: string
          visible_to_client?: boolean
        }
        Update: {
          archived?: boolean
          category?: string
          created_at?: string
          created_by?: string | null
          estimated_minutes?: number | null
          id?: string
          internal_notes?: string | null
          is_default_general?: boolean
          is_default_powerlifting?: boolean
          name?: string
          notes?: string | null
          sections?: Json
          target_lift?: string | null
          updated_at?: string
          visible_to_client?: boolean
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      apply_default_member_access: {
        Args: { _member_id: string }
        Returns: number
      }
      can_access_chat_presence: { Args: { _topic: string }; Returns: boolean }
      can_access_group_presence: { Args: { _topic: string }; Returns: boolean }
      can_manage_group: {
        Args: { _group_id: string; _user_id: string }
        Returns: boolean
      }
      count_active_admins: { Args: never; Returns: number }
      current_coach_id: { Args: never; Returns: string }
      current_member_id: { Args: never; Returns: string }
      delete_email: {
        Args: { message_id: number; queue_name: string }
        Returns: boolean
      }
      enqueue_email: {
        Args: { payload: Json; queue_name: string }
        Returns: number
      }
      get_group_member_profiles: {
        Args: { _group_id: string }
        Returns: {
          avatar_url: string
          full_name: string
          role: string
          user_id: string
        }[]
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_admin_or_media_manager: { Args: { _uid: string }; Returns: boolean }
      is_assigned_coach: { Args: { _client_id: string }; Returns: boolean }
      is_coach_or_admin: { Args: { _user_id: string }; Returns: boolean }
      is_group_admin: {
        Args: { _group_id: string; _user_id: string }
        Returns: boolean
      }
      is_group_member: {
        Args: { _group_id: string; _user_id: string }
        Returns: boolean
      }
      is_media_manager: { Args: { _uid: string }; Returns: boolean }
      jf_member_has_full_access: {
        Args: { _user_id: string }
        Returns: boolean
      }
      mark_client_signed_in: { Args: never; Returns: undefined }
      mark_stale_lift_uploads: { Args: never; Returns: number }
      member_can_consume: { Args: { _user_id: string }; Returns: boolean }
      member_has_access: {
        Args: { _key: string; _member_id: string }
        Returns: boolean
      }
      move_to_dlq: {
        Args: {
          dlq_name: string
          message_id: number
          payload: Json
          source_queue: string
        }
        Returns: number
      }
      ping_client_activity: { Args: { _route?: string }; Returns: undefined }
      pl_recompute_block_status: {
        Args: { _block_id: string }
        Returns: string
      }
      pl_recompute_week_status: { Args: { _week_id: string }; Returns: string }
      pl_week_completed_workouts: {
        Args: { _client_id: string; _week_id: string }
        Returns: number
      }
      pl_week_required_workouts: { Args: { _week_id: string }; Returns: number }
      purge_old_client_media: { Args: never; Returns: undefined }
      read_email_batch: {
        Args: { batch_size: number; queue_name: string; vt: number }
        Returns: {
          message: Json
          msg_id: number
          read_ct: number
        }[]
      }
      user_can_see_broadcast: {
        Args: { _broadcast_id: string; _user_id: string }
        Returns: boolean
      }
      user_can_see_recipe: {
        Args: { _recipe_id: string; _user_id: string }
        Returns: boolean
      }
      user_is_active: { Args: { _user_id: string }; Returns: boolean }
    }
    Enums: {
      app_role: "admin" | "client" | "coach" | "media_manager"
      appointment_source: "manual" | "booking_link" | "external"
      appointment_status: "Scheduled" | "Completed" | "Cancelled" | "NoShow"
      appointment_type:
        | "Coaching Call"
        | "Check-In Call"
        | "Onboarding Call"
        | "Strategy Call"
        | "Consultation"
        | "In-Person Session"
        | "Assessment"
        | "Nutrition Review"
        | "Program Review"
        | "Custom"
      event_audience_scope:
        | "selected_clients"
        | "all_coaching"
        | "app_members"
        | "program_only"
      event_importance: "Low" | "Medium" | "High" | "Critical"
      event_link_type:
        | "Event Website"
        | "Registration Link"
        | "Schedule"
        | "Rules / Info Package"
        | "Athlete Roster"
        | "Livestream"
        | "Location / Map"
        | "Hotel / Travel"
        | "Weigh-In Info"
        | "Payment Link"
        | "Google Meet"
        | "Custom"
      event_reminder_offset:
        | "w12"
        | "w8"
        | "w4"
        | "w2"
        | "w1"
        | "d3"
        | "d1"
        | "day_of"
      event_status: "Draft" | "Active" | "Completed" | "Archived"
      event_type:
        | "Competition"
        | "Powerlifting Meet"
        | "Bodybuilding Show"
        | "Photoshoot"
        | "Testing Day"
        | "Weigh-In"
        | "Travel"
        | "Appointment"
        | "Coaching Call"
        | "Deadline"
        | "Gym Event"
        | "Custom"
      gcal_connection_status:
        | "connected"
        | "reconnect_required"
        | "disconnected"
      group_member_role: "admin" | "member"
      group_permission_mode: "everyone" | "admins_only" | "read_only"
      media_visibility: "private" | "marketing" | "public"
      reminder_audience: "attendee" | "host"
      reminder_status: "pending" | "sent" | "failed" | "skipped"
      review_status:
        | "draft"
        | "needs_review"
        | "approved"
        | "published"
        | "archived"
      task_quadrant: "do" | "schedule" | "delegate" | "eliminate"
      task_status: "open" | "done"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "client", "coach", "media_manager"],
      appointment_source: ["manual", "booking_link", "external"],
      appointment_status: ["Scheduled", "Completed", "Cancelled", "NoShow"],
      appointment_type: [
        "Coaching Call",
        "Check-In Call",
        "Onboarding Call",
        "Strategy Call",
        "Consultation",
        "In-Person Session",
        "Assessment",
        "Nutrition Review",
        "Program Review",
        "Custom",
      ],
      event_audience_scope: [
        "selected_clients",
        "all_coaching",
        "app_members",
        "program_only",
      ],
      event_importance: ["Low", "Medium", "High", "Critical"],
      event_link_type: [
        "Event Website",
        "Registration Link",
        "Schedule",
        "Rules / Info Package",
        "Athlete Roster",
        "Livestream",
        "Location / Map",
        "Hotel / Travel",
        "Weigh-In Info",
        "Payment Link",
        "Google Meet",
        "Custom",
      ],
      event_reminder_offset: [
        "w12",
        "w8",
        "w4",
        "w2",
        "w1",
        "d3",
        "d1",
        "day_of",
      ],
      event_status: ["Draft", "Active", "Completed", "Archived"],
      event_type: [
        "Competition",
        "Powerlifting Meet",
        "Bodybuilding Show",
        "Photoshoot",
        "Testing Day",
        "Weigh-In",
        "Travel",
        "Appointment",
        "Coaching Call",
        "Deadline",
        "Gym Event",
        "Custom",
      ],
      gcal_connection_status: [
        "connected",
        "reconnect_required",
        "disconnected",
      ],
      group_member_role: ["admin", "member"],
      group_permission_mode: ["everyone", "admins_only", "read_only"],
      media_visibility: ["private", "marketing", "public"],
      reminder_audience: ["attendee", "host"],
      reminder_status: ["pending", "sent", "failed", "skipped"],
      review_status: [
        "draft",
        "needs_review",
        "approved",
        "published",
        "archived",
      ],
      task_quadrant: ["do", "schedule", "delegate", "eliminate"],
      task_status: ["open", "done"],
    },
  },
} as const
