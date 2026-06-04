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
      clients: {
        Row: {
          account_created_at: string | null
          account_status: string
          address: string | null
          agreement_link: string | null
          archived: boolean
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
          archived?: boolean
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
          archived?: boolean
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
      exercises: {
        Row: {
          category: string | null
          common_mistakes: string | null
          created_at: string
          cues: string | null
          difficulty: string | null
          equipment: string | null
          id: string
          muscle_group: string | null
          name: string
          tags: string[] | null
          updated_at: string
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
          muscle_group?: string | null
          name: string
          tags?: string[] | null
          updated_at?: string
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
          muscle_group?: string | null
          name?: string
          tags?: string[] | null
          updated_at?: string
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
          cancel_url: string | null
          checkout_url: string | null
          created_at: string
          currency: string | null
          delivery_notes: string | null
          description: string | null
          id: string
          name: string
          notes: string | null
          offer_type: string | null
          payment_structure: string | null
          price: number | null
          status: string
          stripe_payment_link: string | null
          stripe_price_id: string | null
          stripe_product_id: string | null
          success_url: string | null
          updated_at: string
        }
        Insert: {
          cancel_url?: string | null
          checkout_url?: string | null
          created_at?: string
          currency?: string | null
          delivery_notes?: string | null
          description?: string | null
          id?: string
          name: string
          notes?: string | null
          offer_type?: string | null
          payment_structure?: string | null
          price?: number | null
          status?: string
          stripe_payment_link?: string | null
          stripe_price_id?: string | null
          stripe_product_id?: string | null
          success_url?: string | null
          updated_at?: string
        }
        Update: {
          cancel_url?: string | null
          checkout_url?: string | null
          created_at?: string
          currency?: string | null
          delivery_notes?: string | null
          description?: string | null
          id?: string
          name?: string
          notes?: string | null
          offer_type?: string | null
          payment_structure?: string | null
          price?: number | null
          status?: string
          stripe_payment_link?: string | null
          stripe_price_id?: string | null
          stripe_product_id?: string | null
          success_url?: string | null
          updated_at?: string
        }
        Relationships: []
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
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "admin" | "client"
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
      app_role: ["admin", "client"],
    },
  },
} as const
