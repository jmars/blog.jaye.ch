port module ExtractCss exposing (main)

-- Extracts the canonical design-system CSS from the blog-design fork (the
-- single source of truth, vendor/blog-design/src/Fixpoint/Style.elm — the
-- jmars/blog-design submodule, a light "paper" fork of the fixpoint-linux
-- design system) and hands it to Node via a port. Runs as a Platform.worker:
-- no DOM needed, but the same compiled-Elm-under-happy-dom boot shape as the
-- design site's scripts/ssg.mjs.

import Fixpoint.Style
import Json.Encode exposing (Value)
import Platform


port cssOut : String -> Cmd msg


main : Program Value () ()
main =
    Platform.worker
        { init = \_ -> ( (), cssOut Fixpoint.Style.css ) -- emit and exit
        , update = \_ model -> ( model, Cmd.none )
        , subscriptions = \_ -> Sub.none
        }
