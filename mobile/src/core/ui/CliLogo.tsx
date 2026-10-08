import { useMemo } from 'react'
import { Image, StyleSheet, View } from 'react-native'
import Svg, { Path, SvgXml } from 'react-native-svg'
import type { IconReference } from '@shared/domain/cli'
import { radius, useTheme } from '../theme'
import { svgFromDataUri } from './svg-data'
import { Text } from './Text'

/** Letters on the light logo tile (the tile is light in every theme, like the marks it holds). */
const MONOGRAM_INK = '#18181b'

/** A CLI's official mark, from the computer's own registry (never hardcoded here, AGENTS.md rule 15). */
export function CliLogo({ icon, size = 28 }: { icon?: IconReference; size?: number }) {
  const { colors } = useTheme()
  const inner = Math.round(size * 0.64)
  const svg = useMemo(() => (icon?.kind === 'image' ? svgFromDataUri(icon.src) : null), [icon])
  return (
    <View style={[styles.tile, { width: size, height: size, backgroundColor: colors.logoTile }]}>
      {icon?.kind === 'svg' ? (
        <Svg width={inner} height={inner} viewBox={icon.viewBox}>
          <Path d={icon.path} fill={icon.color} />
        </Svg>
      ) : svg ? (
        <SvgXml xml={svg} width={inner} height={inner} />
      ) : icon?.kind === 'image' ? (
        <Image source={{ uri: icon.src }} style={{ width: inner, height: inner }} resizeMode="contain" />
      ) : icon?.kind === 'monogram' ? (
        <Text variant="label" style={{ color: icon.color ?? MONOGRAM_INK, fontSize: Math.round(size * 0.4), fontWeight: '700' }}>
          {icon.text}
        </Text>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  tile: { borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' }
})
