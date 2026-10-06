#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Rect {
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
}

/** Physical desktop coordinates, including negative multi-monitor origins. */
pub fn place(game: Rect, width: i32, height: i32, position: &str) -> (i32, i32) {
    let padding = ((game.width as f64 * 0.025).round() as i32).max(12);
    let x = if position == "lower-right" {
        game.x + game.width - padding - width
    } else {
        game.x + padding
    };
    let y = match position {
        "lower-left" => game.y + game.height - (game.height as f64 * 0.17).round() as i32 - height,
        "lower-right" => game.y + game.height - (game.height as f64 * 0.25).round() as i32 - height,
        _ => game.y + (game.height as f64 * 0.33).round() as i32,
    };
    (
        x.clamp(game.x, game.x + (game.width - width).max(0)),
        y.clamp(game.y, game.y + (game.height - height).max(0)),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn stays_inside_negative_origin_monitor_and_avoids_native_bottom_hud() {
        let game = Rect {
            x: -1920,
            y: 40,
            width: 1920,
            height: 1080,
        };
        for position in ["below-radar", "lower-left", "lower-right"] {
            let (x, y) = place(game, 294, 100, position);
            assert!(x >= game.x && x + 294 <= game.x + game.width);
            assert!(y >= game.y && y + 100 <= game.y + game.height);
        }
        assert!(place(game, 196, 67, "lower-left").1 + 67 < game.y + 1000);
    }
    #[test]
    fn right_placement_accounts_for_scaled_hud_width() {
        let game = Rect {
            x: 0,
            y: 0,
            width: 1920,
            height: 1080,
        };
        assert_eq!(place(game, 196, 67, "lower-right").0, 1676);
        assert_eq!(place(game, 294, 100, "lower-right").0, 1578);
    }
}
