import re
import unicodedata

from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.pipeline import FeatureUnion, Pipeline
from sklearn.linear_model import LogisticRegression


def normalize(text: str) -> str:
    """Normalize a copy; keep stopwords, negations and original records intact."""
    text = unicodedata.normalize("NFKC", text)
    text = re.sub("[\u200b-\u200d\ufeff]", "", text)
    return re.sub(r"\s+", " ", text.replace("\u2019", "'").replace("\u2018", "'")).strip().lower()


def make_pipeline() -> Pipeline:
    return Pipeline([
        ("features", FeatureUnion([
            ("word", TfidfVectorizer(preprocessor=normalize, ngram_range=(1, 2), min_df=2, max_df=0.98, sublinear_tf=True)),
            ("char", TfidfVectorizer(preprocessor=normalize, analyzer="char_wb", ngram_range=(3, 5), min_df=2, sublinear_tf=True)),
        ])),
        ("classifier", LogisticRegression(max_iter=3000, class_weight="balanced", random_state=42)),
    ])
