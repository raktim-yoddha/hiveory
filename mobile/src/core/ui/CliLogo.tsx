import { useMemo } from 'react'
import { Image, StyleSheet, View } from 'react-native'
import Svg, { Path, SvgXml } from 'react-native-svg'
import type { IconReference } from '@shared/domain/cli'
import { radius, useTheme } from '../theme'
import { svgFromDataUri } from './svg-data'
import { Text } from './Text'

/**
 * A CLI's official mark, from the computer's own registry (never hardcoded here, AGENTS.md rule 15).
 * Like the desktop's: the mark fills its square on the app's dark surface (many marks are light and
 * carry their own background), and a CLI without one gets its letters in an outlined square.
 */
export function CliLogo({ icon, size = 28 }: { icon?: IconReference; size?: number }) {
  const { colors } = useTheme()
  const svg = useMemo(() => (icon?.kind === 'image' ? svgFromDataUri(icon.src) : null), [icon])
  const box = { width: size, height: size }
  if (icon?.kind === 'svg') {
    return (
      <Svg {...box} viewBox={icon.viewBox}>
        <Path d={icon.path} fill={icon.color} />
      </Svg>
    )
  }
  if (svg) return <SvgXml xml={svg} {...box} />
  if (icon?.kind === 'image') return <Image source={{ uri: icon.src }} style={[box, styles.image]} resizeMode="contain" />
  const color = (icon?.kind === 'monogram' && icon.color) || colors.textSecondary
  return (
    <View style={[box, styles.monogram, { borderColor: colors.border }]}>
      <Text variant="label" style={{ color, fontSize: Math.round(size * 0.38), fontWeight: '700' }}>
        {icon?.kind === 'monogram' ? icon.text : '?'}
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  image: { borderRadius: radius.sm * 0.6 },
  monogram: { borderRadius: radius.sm, borderWidth: StyleSheet.hairlineWidth * 2, alignItems: 'center', justifyContent: 'center' }
})
