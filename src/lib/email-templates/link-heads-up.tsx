import * as React from 'react'
import { Text } from '@react-email/components'
import { LINK_HEADS_UP } from '../sms-identity'

/** Under every email button: a cold open can be slow, so nobody gives up on the link. */
export const LinkHeadsUp = () => <Text style={note}>{LINK_HEADS_UP}</Text>

const note = { fontSize: '12px', color: '#8a8c91', lineHeight: '1.5', margin: '10px 0 0' }
