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
      cardio_targets: {
        Row: {
          admin_notes: string | null
          cardio_type: string
          client_id: string
          client_notes: string | null
          created_at: string
          custom_type: string | null
          duration_minutes: number | null
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
          start_date: string
          status: string
          step_target: number | null
          updated_at: string
          visible_to_client: boolean
        }
        Insert: {
          admin_notes?: string | null
          cardio_type?: string
          client_id: string
          client_notes?: string | null
          created_at?: string
          custom_type?: string | null
          duration_minutes?: number | null
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
          start_date: string
          status?: string
          step_target?: number | null
          updated_at?: string
          visible_to_client?: boolean
        }
        Update: {
          admin_notes?: string | null
          cardio_type?: string
          client_id?: string
          client_notes?: string | null
          created_at?: string
          custom_type?: string | null
          duration_minutes?: number | null
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
          archived: boolean
          assigned_coach_id: string | null
          calendar_link: string | null
          checkin_form_link: string | null
          city: string | null
          coach_notes: string | null
          coaching_package: string | null
          coaching_type: string | null
          country: string | null
          created_at: string
          default_session_location: string | null
          drive_folder_link: string | null
          email: string | null
          first_name: string | null
          full_name: string
          goals: string | null
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
          last_name: string | null
          last_program_update: string | null
          lifestyle_notes: string | null
          needs_admin_help: boolean
          next_program_update: string | null
          nutrition_notes: string | null
          onboarded_by_coach_id: string | null
          package_tracking_enabled: boolean
          password_reset_sent_at: string | null
          payment_status: string | null
          phone: string | null
          postal_code: string | null
          profile_picture_updated_at: string | null
          profile_picture_url: string | null
          program_phase: string | null
          program_sheet_link: string | null
          province: string | null
          renewal_date: string | null
          sessions_purchased: number
          sessions_used: number
          start_date: string | null
          status: string
          stripe_link: string | null
          tags: string[]
          timezone: string
          timezone_confirmed_at: string | null
          training_notes: string | null
          updated_at: string
          user_id: string | null
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
          archived?: boolean
          assigned_coach_id?: string | null
          calendar_link?: string | null
          checkin_form_link?: string | null
          city?: string | null
          coach_notes?: string | null
          coaching_package?: string | null
          coaching_type?: string | null
          country?: string | null
          created_at?: string
          default_session_location?: string | null
          drive_folder_link?: string | null
          email?: string | null
          first_name?: string | null
          full_name: string
          goals?: string | null
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
          last_name?: string | null
          last_program_update?: string | null
          lifestyle_notes?: string | null
          needs_admin_help?: boolean
          next_program_update?: string | null
          nutrition_notes?: string | null
          onboarded_by_coach_id?: string | null
          package_tracking_enabled?: boolean
          password_reset_sent_at?: string | null
          payment_status?: string | null
          phone?: string | null
          postal_code?: string | null
          profile_picture_updated_at?: string | null
          profile_picture_url?: string | null
          program_phase?: string | null
          program_sheet_link?: string | null
          province?: string | null
          renewal_date?: string | null
          sessions_purchased?: number
          sessions_used?: number
          start_date?: string | null
          status?: string
          stripe_link?: string | null
          tags?: string[]
          timezone?: string
          timezone_confirmed_at?: string | null
          training_notes?: string | null
          updated_at?: string
          user_id?: string | null
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
          archived?: boolean
          assigned_coach_id?: string | null
          calendar_link?: string | null
          checkin_form_link?: string | null
          city?: string | null
          coach_notes?: string | null
          coaching_package?: string | null
          coaching_type?: string | null
          country?: string | null
          created_at?: string
          default_session_location?: string | null
          drive_folder_link?: string | null
          email?: string | null
          first_name?: string | null
          full_name?: string
          goals?: string | null
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
          last_name?: string | null
          last_program_update?: string | null
          lifestyle_notes?: string | null
          needs_admin_help?: boolean
          next_program_update?: string | null
          nutrition_notes?: string | null
          onboarded_by_coach_id?: string | null
          package_tracking_enabled?: boolean
          password_reset_sent_at?: string | null
          payment_status?: string | null
          phone?: string | null
          postal_code?: string | null
          profile_picture_updated_at?: string | null
          profile_picture_url?: string | null
          program_phase?: string | null
          program_sheet_link?: string | null
          province?: string | null
          renewal_date?: string | null
          sessions_purchased?: number
          sessions_used?: number
          start_date?: string | null
          status?: string
          stripe_link?: string | null
          tags?: string[]
          timezone?: string
          timezone_confirmed_at?: string | null
          training_notes?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Relationships: []
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
      coaches: {
        Row: {
          archived: boolean
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
      coaching_products: {
        Row: {
          active: boolean
          created_at: string
          created_by: string | null
          currency: string
          description: string | null
          details: string | null
          id: string
          image_url: string | null
          name: string
          payment_link_url: string | null
          price_cents: number
          stripe_payment_link_id: string | null
          stripe_price_id: string | null
          stripe_product_id: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          currency?: string
          description?: string | null
          details?: string | null
          id?: string
          image_url?: string | null
          name: string
          payment_link_url?: string | null
          price_cents: number
          stripe_payment_link_id?: string | null
          stripe_price_id?: string | null
          stripe_product_id?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          currency?: string
          description?: string | null
          details?: string | null
          id?: string
          image_url?: string | null
          name?: string
          payment_link_url?: string | null
          price_cents?: number
          stripe_payment_link_id?: string | null
          stripe_price_id?: string | null
          stripe_product_id?: string | null
          updated_at?: string
        }
        Relationships: []
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
      exercises: {
        Row: {
          category: string | null
          common_mistakes: string | null
          created_at: string
          cues: string | null
          difficulty: string | null
          equipment: string | null
          id: string
          legacy_youtube_url: string | null
          muscle_group: string | null
          name: string
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
          youtube_fallback_allowed: boolean
          youtube_replaced: boolean
          youtube_url: string | null
        }
        Insert: {
          category?: string | null
          common_mistakes?: string | null
          created_at?: string
          cues?: string | null
          difficulty?: string | null
          equipment?: string | null
          id?: string
          legacy_youtube_url?: string | null
          muscle_group?: string | null
          name: string
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
          youtube_fallback_allowed?: boolean
          youtube_replaced?: boolean
          youtube_url?: string | null
        }
        Update: {
          category?: string | null
          common_mistakes?: string | null
          created_at?: string
          cues?: string | null
          difficulty?: string | null
          equipment?: string | null
          id?: string
          legacy_youtube_url?: string | null
          muscle_group?: string | null
          name?: string
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
          youtube_fallback_allowed?: boolean
          youtube_replaced?: boolean
          youtube_url?: string | null
        }
        Relationships: []
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
      lift_video_comments: {
        Row: {
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
          exercise: string
          id: string
          important_date_id: string | null
          is_urgent: boolean
          liked_at: string | null
          liked_by: string | null
          load_text: string | null
          phase_id: string | null
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
          uploaded_by: string | null
          video_source: string
          video_storage_path: string | null
          video_url: string | null
          watched_at: string | null
          watched_by: string | null
        }
        Insert: {
          admin_last_viewed_at?: string | null
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
          exercise?: string
          id?: string
          important_date_id?: string | null
          is_urgent?: boolean
          liked_at?: string | null
          liked_by?: string | null
          load_text?: string | null
          phase_id?: string | null
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
          uploaded_by?: string | null
          video_source?: string
          video_storage_path?: string | null
          video_url?: string | null
          watched_at?: string | null
          watched_by?: string | null
        }
        Update: {
          admin_last_viewed_at?: string | null
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
          exercise?: string
          id?: string
          important_date_id?: string | null
          is_urgent?: boolean
          liked_at?: string | null
          liked_by?: string | null
          load_text?: string | null
          phase_id?: string | null
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
          uploaded_by?: string | null
          video_source?: string
          video_storage_path?: string | null
          video_url?: string | null
          watched_at?: string | null
          watched_by?: string | null
        }
        Relationships: []
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
      messages: {
        Row: {
          attachments: Json
          body: string
          client_id: string
          created_at: string
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
          steps: number | null
          target_id: string
          water: number | null
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
          steps?: number | null
          target_id: string
          water?: number | null
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
          steps?: number | null
          target_id?: string
          water?: number | null
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
          phase: string
          start_date: string
          status: string
          structure: string
          updated_at: string
          visible_to_client: boolean
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
          phase?: string
          start_date: string
          status?: string
          structure?: string
          updated_at?: string
          visible_to_client?: boolean
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
          phase?: string
          start_date?: string
          status?: string
          structure?: string
          updated_at?: string
          visible_to_client?: boolean
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
          is_recurring: boolean | null
          is_template: boolean
          last_edited_at: string | null
          late_arrival_policy: string | null
          late_failed_policy: string | null
          location: string | null
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
          is_recurring?: boolean | null
          is_template?: boolean
          last_edited_at?: string | null
          late_arrival_policy?: string | null
          late_failed_policy?: string | null
          location?: string | null
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
          is_recurring?: boolean | null
          is_template?: boolean
          last_edited_at?: string | null
          late_arrival_policy?: string | null
          late_failed_policy?: string | null
          location?: string | null
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
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          email: string | null
          full_name: string | null
          id: string
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id: string
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
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
          stripe_payment_link: string | null
          stripe_price_id: string | null
          stripe_product_id: string | null
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
          stripe_payment_link?: string | null
          stripe_price_id?: string | null
          stripe_product_id?: string | null
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
          stripe_payment_link?: string | null
          stripe_price_id?: string | null
          stripe_product_id?: string | null
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
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      current_coach_id: { Args: never; Returns: string }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_assigned_coach: { Args: { _client_id: string }; Returns: boolean }
    }
    Enums: {
      app_role: "admin" | "client" | "coach"
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
      app_role: ["admin", "client", "coach"],
    },
  },
} as const
