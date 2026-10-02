module Reader.Document exposing
    ( Block(..)
    , Correction
    , Doc
    , Entry
    , Flow(..)
    , Inline(..)
    , NoteDef
    , Page
    , Para
    , TocEntry
    , applyCorrections
    , decoder
    , flow
    , noteTexts
    , pageCount
    )

{-| The DOCUMENT the reader consumes — the typed blocks a stored edition is
served as, and the grouping the view renders them in.

The served blocks are the VERBATIM transcription. Nothing here repairs them:
`corrections` travel beside the text as rules, and the reading view applies them
while the transcription view shows the blocks as they are. That is the whole
point of the two views, and of the diff view (which is the rule list itself).

The grouping in `flow` is a rendering concern, not a second transcription:

  - a note reference that splits a paragraph into two text runs is ONE paragraph
    with a superscript in the middle, because that is one paragraph in the print;
  - the pieces of one note (the edition sets a long note across several blocks)
    are ONE note;
  - a running head is furniture, suppressed in the reading view and shown in the
    transcription view.

Paragraph anchors (`#s4-3`) are derived from the block sequence: the extractor
labels only the paragraphs a reference lands on, so a paragraph without a label
takes the next number in its section that no labelled paragraph claims. That
keeps every anchor unique and in document order, which is what a reserved
grammar needs; it does not claim to be the extractor's own numbering.

-}

import Dict exposing (Dict)
import Json.Decode as D
import Set exposing (Set)


type alias Doc =
    { slug : String
    , lang : String
    , item : String
    , pages : List Page
    , toc : List TocEntry
    , blocks : List Block
    , corrections : List Correction
    }


type alias Page =
    { leaf : Maybe Int, page : Maybe Int }


type alias TocEntry =
    { id : String, n : Int, title : String, page : Maybe Int }


type alias Correction =
    { find : String, repl : String, cls : String, note : String }


type Block
    = BRegion String (Maybe String)
    | BSec Int String (Maybe Int)
    | BPara String (Maybe String)
    | BVerse String (Maybe String)
    | BRh String
    | BPb (Maybe Int) String (Maybe String) (Maybe String)
    | BRef Int String (Maybe String) (Maybe String)
    | BNote Int String (Maybe String) (Maybe String)


{-| One rendered item. `region` says which part of the volume it belongs to, so
search hits and the progress meter can exclude the front matter and the
advertisements (the marks exist for exactly that). -}
type alias Entry =
    { region : String, item : Flow }


type Flow
    = FRegion String (Maybe String)
    | FSec Int String (Maybe Int)
    | FPage (Maybe Int) String (Maybe String) (Maybe String)
    | FRh String
    | FNote NoteDef
    | FPara Para


type alias NoteDef =
    { n : Int, id : Maybe String, lang : Maybe String, texts : List String }


type alias Para =
    { id : Maybe String, parts : List Inline }


type Inline
    = IText String
    | IVerse String
    | IRef Int String String


{-| The reading view: the rules applied in order, every occurrence. -}
applyCorrections : List Correction -> String -> String
applyCorrections rules text =
    List.foldl (\r acc -> String.replace r.find r.repl acc) text rules


{-| Note text by number, for the margin copy and the popover — a note is never
looked up by page, so a note and its reference on different pages costs nothing.
-}
noteTexts : List Entry -> Dict Int String
noteTexts entries =
    List.foldl
        (\e acc ->
            case e.item of
                FNote n ->
                    Dict.insert n.n (String.join " " n.texts) acc

                _ ->
                    acc
        )
        Dict.empty
        entries


pageCount : Doc -> Int
pageCount doc =
    List.length (List.filter (\p -> p.page /= Nothing) doc.pages)


{- ---------- the decoder ---------- -}

decoder : D.Decoder Doc
decoder =
    D.oneOf [ D.field "corrections" (D.list correction), D.succeed [] ]
        |> D.andThen
            (\cs ->
                D.map6 (\s l i ps t bs -> Doc s l i ps t bs cs)
                    (D.field "slug" D.string)
                    (D.field "lang" D.string)
                    (D.field "source" (D.field "item" D.string))
                    (D.field "pages" (D.list page))
                    (D.field "toc" (D.list tocEntry))
                    (D.field "blocks" (D.list block))
            )


page : D.Decoder Page
page =
    D.map2 Page (D.maybe (D.field "leaf" D.int)) (D.maybe (D.field "page" D.int))


tocEntry : D.Decoder TocEntry
tocEntry =
    D.map4 TocEntry
        (D.field "id" D.string)
        (D.field "n" D.int)
        (D.field "title" D.string)
        (D.maybe (D.field "page" D.int))


correction : D.Decoder Correction
correction =
    D.map4 Correction
        (D.field "find" D.string)
        (D.field "repl" D.string)
        (D.field "cls" D.string)
        (D.field "note" D.string)


block : D.Decoder Block
block =
    D.field "t" D.string
        |> D.andThen
            (\t ->
                case t of
                    "region" ->
                        D.map2 BRegion
                            (D.field "kind" D.string)
                            (D.maybe (D.field "id" D.string))

                    "sec" ->
                        D.map3 BSec
                            (D.field "n" D.int)
                            (D.field "id" D.string)
                            (D.maybe (D.field "page" D.int))

                    "p" ->
                        D.map2 BPara
                            (D.field "x" D.string)
                            (D.maybe (D.field "at" D.string))

                    "verse" ->
                        D.map2 BVerse
                            (D.field "x" D.string)
                            (D.maybe (D.field "at" D.string))

                    "rh" ->
                        D.map BRh (D.field "x" D.string)

                    "pb" ->
                        D.map4 BPb
                            (D.maybe (D.field "page" D.int))
                            (D.field "how" D.string)
                            (D.maybe (D.field "id" D.string))
                            (D.maybe (D.field "x" D.string))

                    "ref" ->
                        D.map4 BRef
                            (D.field "n" D.int)
                            (D.field "x" D.string)
                            (D.maybe (D.field "at" D.string))
                            (D.maybe (D.field "id" D.string))

                    "notedef" ->
                        D.map4 BNote
                            (D.field "n" D.int)
                            (D.field "x" D.string)
                            (D.maybe (D.field "id" D.string))
                            (D.maybe (D.field "lang" D.string))

                    _ ->
                        D.fail ("unknown block type " ++ t)
            )


{- ---------- grouping ---------- -}

type Open
    = ONone
    | OPara (Maybe String) Bool (List Inline)
    | ONote NoteDef


type alias St =
    { region : String
    , section : Maybe String
    , labels : Set String
    , used : Set String
    , out : List Entry
    , open : Open
    , lastRef : Bool
    }


{-| Every block, in document order, grouped for rendering. -}
flow : List Block -> List Entry
flow blocks =
    let
        labels =
            -- the paragraph labels the extractor itself assigns, per section: a
            -- derived number must not take one of them
            List.foldl
                (\b acc ->
                    case ( b, List.head acc.stack ) of
                        ( BSec _ id _, _ ) ->
                            { acc | stack = id :: acc.stack }

                        ( BPara _ (Just at), Just sec ) ->
                            { acc | bySection = Dict.update sec (addLabel at) acc.bySection }

                        ( BVerse _ (Just at), Just sec ) ->
                            { acc | bySection = Dict.update sec (addLabel at) acc.bySection }

                        _ ->
                            acc
                )
                { stack = [], bySection = Dict.empty }
                blocks

        st =
            List.foldl (step labels.bySection)
                { region = ""
                , section = Nothing
                , labels = Set.empty
                , used = Set.empty
                , out = []
                , open = ONone
                , lastRef = False
                }
                blocks
    in
    (close st).out |> List.reverse


addLabel : String -> Maybe (Set String) -> Maybe (Set String)
addLabel at acc =
    acc |> Maybe.withDefault Set.empty |> Set.insert at |> Just


emit : St -> Flow -> St
emit st item =
    { st | out = { region = st.region, item = item } :: st.out, open = ONone }


close : St -> St
close st =
    case st.open of
        OPara id _ parts ->
            if List.isEmpty parts then
                { st | open = ONone }

            else
                { st | out = { region = st.region, item = FPara { id = id, parts = List.reverse parts } } :: st.out, open = ONone }

        ONote n ->
            { st | out = { region = st.region, item = FNote n } :: st.out, open = ONone }

        ONone ->
            st


step : Dict String (Set String) -> Block -> St -> St
step bySection b st =
    case b of
        BRegion kind id ->
            -- the region is set on the state and CARRIED by every entry after it:
            -- the front matter and the advertisements are excluded from search
            -- and from the progress meter by this mark, and an entry that reports
            -- no region excludes nothing. (MEASURED: with the region unset every
            -- item read as "" and both exclusions were inert.)
            let
                closed =
                    close st
            in
            emit { closed | region = kind } (FRegion kind id)

        BSec n id pg ->
            emit (close { st | section = Just id, used = Set.empty, labels = Dict.get id bySection |> Maybe.withDefault Set.empty }) (FSec n id pg)

        BPb pg how id raw ->
            emit (close st) (FPage pg how id raw)

        BRh x ->
            emit (close st) (FRh x)

        BPara x at ->
            appendOrOpen st (IText x) at

        BVerse x at ->
            appendOrOpen st (IVerse x) at

        BRef n x at id ->
            case st.open of
                OPara oid authOn parts ->
                    let
                        ( nid, nauth ) =
                            case ( oid, at ) of
                                ( Nothing, Just a ) ->
                                    ( Just a, True )

                                _ ->
                                    ( oid, authOn )
                    in
                    { st
                        | open = OPara nid nauth (IRef n x (Maybe.withDefault "" id) :: parts)
                        , lastRef = True
                        , used = addUsed nid st.used
                    }

                _ ->
                    let
                        nid =
                            at

                        nauth =
                            at /= Nothing
                    in
                    { st
                        | open = OPara nid nauth [ IRef n x (Maybe.withDefault "" id) ]
                        , lastRef = True
                        , used = addUsed nid st.used
                    }

        BNote n x id lang ->
            case st.open of
                ONote prev ->
                    if prev.n == n then
                        { st
                            | open =
                                ONote
                                    { prev
                                        | texts = x :: prev.texts
                                        , id = firstJust prev.id id
                                        , lang = firstJust prev.lang lang
                                    }
                            , lastRef = False
                        }

                    else
                        openNote (close st) n x id lang

                _ ->
                    openNote (close st) n x id lang


{-| A text block continues the open paragraph only when a reference split it —
the extractor's own label decides, so two different labelled paragraphs are
never merged into one anchor. -}
appendOrOpen : St -> Inline -> Maybe String -> St
appendOrOpen st part at =
    case st.open of
        OPara id authOn parts ->
            if st.lastRef && at == id then
                { st | open = OPara id authOn (part :: parts), lastRef = False }

            else if st.lastRef && at == Nothing && not authOn then
                { st | open = OPara id authOn (part :: parts), lastRef = False }

            else
                openPara (close st) part at

        _ ->
            openPara (close st) part at


firstJust : Maybe a -> Maybe a -> Maybe a
firstJust a b =
    case a of
        Just _ ->
            a

        Nothing ->
            b


addUsed : Maybe String -> Set String -> Set String
addUsed id used =
    case id of
        Just i ->
            Set.insert i used

        Nothing ->
            used


openPara : St -> Inline -> Maybe String -> St
openPara st part at =
    let
        id =
            case at of
                Just a ->
                    Just a

                Nothing ->
                    case st.section of
                        Just sec ->
                            Just (sec ++ "-" ++ String.fromInt (nextFree st 1))

                        Nothing ->
                            Nothing
    in
    { st
        | open = OPara id (at /= Nothing) [ part ]
        , lastRef = False
        , used = addUsed id st.used
    }


{-| The lowest number in this section that neither a labelled paragraph nor an
already-numbered one claims — unique, and in document order. -}
nextFree : St -> Int -> Int
nextFree st from =
    let
        candidate =
            case st.section of
                Just sec ->
                    sec ++ "-" ++ String.fromInt from

                Nothing ->
                    ""
    in
    if Set.member candidate st.labels || Set.member candidate st.used then
        nextFree st (from + 1)

    else
        from


openNote : St -> Int -> String -> Maybe String -> Maybe String -> St
openNote st n x id lang =
    { st | open = ONote { n = n, id = id, lang = lang, texts = [ x ] }, lastRef = False }
